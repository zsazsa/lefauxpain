/**
 * Strudel Sandbox Entry Point
 *
 * Runs inside <iframe sandbox="allow-scripts"> — no access to parent's
 * localStorage, cookies, or DOM. Communicates via postMessage only.
 *
 * Protocol:
 *   Parent → Iframe:
 *     {op: "set_code", code}         — Remote edit from another user
 *     {op: "evaluate", code, cps}    — Start playback
 *     {op: "stop"}                   — Stop playback
 *     {op: "set_cps", cps}           — Change tempo
 *
 *   Iframe → Parent:
 *     {op: "ready"}                  — Strudel loaded, prebake done
 *     {op: "code_change", code}      — User typed in editor
 *     {op: "state", isPlaying}       — Playback state changed
 *     {op: "error", message}         — Eval/runtime error
 */

let mirror: any = null;
let suppressCodeChange = false;

// Intercept console to catch Strudel sound errors and forward to parent
const origWarn = console.warn;
const origError = console.error;
const soundErrorPattern = /sound .+ not found|Is it loaded/;
const seenErrors = new Set<string>();

function interceptConsole() {
  const handler = (...args: any[]) => {
    const msg = args.map(String).join(" ");
    if (soundErrorPattern.test(msg)) {
      // Extract sound name
      const match = msg.match(/sound (\S+) not found/);
      const soundName = match?.[1] || "unknown";
      if (!seenErrors.has(soundName)) {
        seenErrors.add(soundName);
        parent.postMessage({ op: "sound_error", sound: soundName, message: msg }, "*");
      }
    }
  };
  console.warn = (...args: any[]) => { handler(...args); origWarn.apply(console, args); };
  console.error = (...args: any[]) => { handler(...args); origError.apply(console, args); };
}
interceptConsole();

async function init() {
  const root = document.getElementById("strudel-root")!;

  try {
    const [codemirror, webaudio, transpiler, core, soundfonts] = await Promise.all([
      import("@strudel/codemirror"),
      import("@strudel/webaudio"),
      import("@strudel/transpiler"),
      import("@strudel/core"),
      import("@strudel/soundfonts"),
    ]);

    const { StrudelMirror } = codemirror;
    const {
      webaudioOutput,
      getAudioContext,
      initAudioOnFirstClick,
      registerSynthSounds,
      registerZZFXSounds,
      samples,
    } = webaudio;
    const { transpiler: transpilerFn } = transpiler;
    const { evalScope } = core;
    const { registerSoundfonts } = soundfonts;

    initAudioOnFirstClick();

    const prebake = async () => {
      await Promise.all([
        evalScope(
          core,
          import("@strudel/mini"),
          webaudio,
          codemirror,
        ),
        registerSynthSounds(),
        registerZZFXSounds(),
        registerSoundfonts(),
        samples("github:tidalcycles/dirt-samples").catch(() => {}),
        samples("github:tidalcycles/uzu-drumkit").catch(() => {}),
      ]);
    };

    root.innerHTML = "";

    mirror = new StrudelMirror({
      root,
      initialCode: "",
      defaultOutput: webaudioOutput,
      getTime: () => getAudioContext().currentTime,
      transpiler: transpilerFn,
      prebake,
      solo: false,
      onUpdateState: (state: any) => {
        if (state.code !== undefined && !suppressCodeChange) {
          parent.postMessage({ op: "code_change", code: state.code }, "*");
        }
      },
    });

    parent.postMessage({ op: "ready" }, "*");
  } catch (e: any) {
    root.innerHTML = `<div class="error">${e.message || "Failed to load Strudel"}</div>`;
    parent.postMessage({ op: "error", message: e.message || "Failed to load Strudel" }, "*");
  }
}

window.addEventListener("message", async (event) => {
  const { op } = event.data || {};
  if (!mirror) return;

  switch (op) {
    case "set_code": {
      suppressCodeChange = true;
      mirror.setCode(event.data.code);
      suppressCodeChange = false;
      break;
    }
    case "evaluate": {
      try {
        if (event.data.code !== undefined) {
          suppressCodeChange = true;
          mirror.setCode(event.data.code);
          suppressCodeChange = false;
        }
        if (event.data.cps !== undefined && mirror.repl?.scheduler) {
          mirror.repl.scheduler.setCps(event.data.cps);
        }
        await mirror.evaluate();
        parent.postMessage({ op: "state", isPlaying: true }, "*");
      } catch (e: any) {
        parent.postMessage({ op: "error", message: e.message }, "*");
      }
      break;
    }
    case "stop": {
      try {
        await mirror.stop();
        parent.postMessage({ op: "state", isPlaying: false }, "*");
      } catch {}
      break;
    }
    case "set_cps": {
      if (mirror.repl?.scheduler && event.data.cps > 0) {
        mirror.repl.scheduler.setCps(event.data.cps);
      }
      break;
    }
  }
});

init();

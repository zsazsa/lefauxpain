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
let suppressToggle = false;
let autoEvalTimer: number | undefined;
let lastKnownCode: string | undefined;

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
      initAudio,
      initAudioOnFirstClick,
      registerSynthSounds,
      registerZZFXSounds,
      samples,
    } = webaudio;
    const { transpiler: transpilerFn } = transpiler;
    const { evalScope } = core;
    const { registerSoundfonts, setSoundfontUrl } = soundfonts;

    // Init audio on first user gesture inside iframe (for Ctrl+Enter)
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
      // Lock soundfont URL after registration — prevents user code from
      // redirecting loadFont() to other CSP-whitelisted domains for eval()
      try {
        Object.defineProperty(soundfonts, "setSoundfontUrl", {
          value: () => {},
          writable: false,
          configurable: false,
        });
      } catch {};
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
      onToggle: (started: boolean) => {
        if (!suppressToggle) {
          parent.postMessage({ op: "state", isPlaying: started }, "*");
        }
      },
      onUpdateState: (state: any) => {
        if (state.code !== undefined && !suppressCodeChange && state.code !== lastKnownCode) {
          lastKnownCode = state.code;
          parent.postMessage({ op: "code_change", code: state.code }, "*");
          // Auto-evaluate on code change while playing
          if (mirror?.repl?.scheduler?.started) {
            clearTimeout(autoEvalTimer);
            autoEvalTimer = window.setTimeout(() => {
              mirror?.evaluate?.();
            }, 300);
          }
        }
      },
    });

    parent.postMessage({ op: "ready" }, "*");
  } catch (e: any) {
    const errDiv = document.createElement("div");
    errDiv.className = "error";
    errDiv.textContent = e.message || "Failed to load Strudel";
    root.replaceChildren(errDiv);
    parent.postMessage({ op: "error", message: e.message || "Failed to load Strudel" }, "*");
  }
}

window.addEventListener("message", async (event) => {
  const { op } = event.data || {};
  if (!mirror) return;

  switch (op) {
    case "set_code": {
      suppressCodeChange = true;
      lastKnownCode = event.data.code;
      mirror.setCode(event.data.code);
      suppressCodeChange = false;
      break;
    }
    case "evaluate": {
      try {
        // Ensure AudioContext + worklets are loaded before playback
        await initAudio();
        if (event.data.code !== undefined) {
          suppressCodeChange = true;
          lastKnownCode = event.data.code;
          mirror.setCode(event.data.code);
          suppressCodeChange = false;
        }
        if (event.data.cps !== undefined && mirror.repl?.scheduler) {
          mirror.repl.scheduler.setCps(event.data.cps);
        }
        // Suppress onToggle during parent-initiated evaluate to prevent feedback loop
        suppressToggle = true;
        await mirror.evaluate();
        suppressToggle = false;
      } catch (e: any) {
        suppressToggle = false;
        parent.postMessage({ op: "error", message: e.message }, "*");
      }
      break;
    }
    case "stop": {
      try {
        clearTimeout(autoEvalTimer);
        suppressToggle = true;
        await mirror.stop();
        suppressToggle = false;
      } catch {
        suppressToggle = false;
      }
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

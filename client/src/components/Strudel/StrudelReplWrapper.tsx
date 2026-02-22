import { onMount, onCleanup, createSignal, createEffect } from "solid-js";

let strudelPromise: Promise<any> | null = null;

function loadStrudel() {
  if (!strudelPromise) {
    strudelPromise = Promise.all([
      import("@strudel/codemirror"),
      import("@strudel/webaudio"),
      import("@strudel/transpiler"),
      import("@strudel/core"),
    ]);
  }
  return strudelPromise;
}

// Built by onMount after modules are loaded — uses the same module instances as StrudelMirror
let prebakeFn: (() => Promise<void>) | null = null;

export type StrudelReplHandle = {
  setCode: (code: string) => void;
  getCode: () => string;
  evaluate: () => Promise<void>;
  stop: () => Promise<void>;
  setCps: (cps: number) => void;
  isPlaying: () => boolean;
};

interface Props {
  initialCode: string;
  readOnly?: boolean;
  onCodeChange?: (code: string) => void;
  onHandle?: (handle: StrudelReplHandle) => void;
}

export default function StrudelReplWrapper(props: Props) {
  let containerRef: HTMLDivElement | undefined;
  let mirror: any = null;
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);

  onMount(async () => {
    try {
      const [codemirror, webaudio, transpiler, core] = await loadStrudel();

      if (!containerRef) return;

      const { StrudelMirror } = codemirror;
      const { webaudioOutput, getAudioContext, initAudioOnFirstClick,
              registerSynthSounds, registerZZFXSounds, samples } = webaudio;
      const { transpiler: transpilerFn } = transpiler;
      const { evalScope } = core;

      // Ensure AudioContext gets resumed on first user gesture
      initAudioOnFirstClick();

      // Build prebake using the SAME module instances that StrudelMirror will use
      if (!prebakeFn) {
        prebakeFn = async () => {
          await Promise.all([
            evalScope(
              core,
              import("@strudel/mini"),
              webaudio,
              codemirror,
            ),
            registerSynthSounds(),
            registerZZFXSounds(),
            samples("github:tidalcycles/dirt-samples").catch(() => {}),
            samples("github:tidalcycles/uzu-drumkit").catch(() => {}),
          ]);
        };
      }

      mirror = new StrudelMirror({
        root: containerRef,
        initialCode: props.initialCode,
        defaultOutput: webaudioOutput,
        getTime: () => getAudioContext().currentTime,
        transpiler: transpilerFn,
        prebake: prebakeFn,
        solo: false,
        onUpdateState: (state: any) => {
          if (state.code !== undefined && props.onCodeChange) {
            props.onCodeChange(state.code);
          }
        },
      });

      const handle: StrudelReplHandle = {
        setCode: (code: string) => {
          if (mirror) mirror.setCode(code);
        },
        getCode: () => mirror?.code || "",
        evaluate: async () => {
          if (mirror) await mirror.evaluate();
        },
        stop: async () => {
          if (mirror) await mirror.stop();
        },
        setCps: (cps: number) => {
          if (mirror?.repl?.scheduler) {
            mirror.repl.scheduler.setCps(cps);
          }
        },
        isPlaying: () => mirror?.repl?.state?.started || false,
      };

      props.onHandle?.(handle);
      setLoading(false);
    } catch (e: any) {
      console.error("[strudel] Failed to load:", e);
      setError(e.message || "Failed to load Strudel");
      setLoading(false);
    }
  });

  // Update read-only state
  createEffect(() => {
    if (mirror?.editor) {
      mirror.editor.dispatch({
        effects: mirror.editor.state.facet ? [] : [],
      });
    }
  });

  onCleanup(() => {
    if (mirror) {
      try {
        mirror.stop();
        mirror.clear();
      } catch {}
      mirror = null;
    }
  });

  return (
    <div style={{ flex: "1", "min-height": "0", display: "flex", "flex-direction": "column" }}>
      {loading() && (
        <div style={{
          display: "flex",
          "align-items": "center",
          "justify-content": "center",
          height: "100%",
          color: "var(--text-muted)",
          "font-size": "13px",
        }}>
          Loading Strudel...
        </div>
      )}
      {error() && (
        <div style={{
          display: "flex",
          "align-items": "center",
          "justify-content": "center",
          height: "100%",
          color: "var(--danger)",
          "font-size": "13px",
        }}>
          {error()}
        </div>
      )}
      <div
        ref={containerRef}
        style={{
          flex: "1",
          "min-height": "0",
          overflow: "auto",
          display: loading() || error() ? "none" : "flex",
          "flex-direction": "column",
        }}
      />
    </div>
  );
}

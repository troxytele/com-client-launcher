// Crash Report Analyzer: reads a crash report / log and explains what most likely went wrong, in plain words.

export type Finding = {
  level: "fix" | "info";
  title: string;
  text: string;
  /** lines of the report that show it (for the viewer to highlight) */
  match?: string;
};

type Rule = { test: RegExp; title: string; text: (m: RegExpMatchArray) => string; level?: "fix" | "info" };

const RULES: Rule[] = [
  {
    test: /java\.lang\.OutOfMemoryError|There is insufficient memory for the Java Runtime/,
    title: "Ran out of memory",
    text: () => "Minecraft used up all the memory it was given. Raise Memory in Settings → Profile (4–6 GB is a good amount), or remove heavy mods / shaders.",
  },
  {
    test: /Incompatible mods? found!?|Mod resolution encountered an incompatible mod set|Could not find required mod: (\S+)|requires (?:version [^ ]+ (?:or later )?of |any version of )['"]?([\w.-]+)/i,
    title: "A mod is missing or doesn't fit",
    text: (m) =>
      `Fabric refused to start because a mod needs something that isn't there (or the wrong version)${m[1] || m[2] ? `: ${m[1] || m[2]}` : ""}. ` +
      "Open Mods and install / update what it asks for, or remove the mod that needs it.",
  },
  {
    test: /Duplicate mods? found|Mod ID ['"]?([\w-]+)['"]? is present multiple times|found duplicate mod/i,
    title: "The same mod twice",
    text: (m) => `A mod is in your mods folder twice${m[1] ? ` (${m[1]})` : ""}. Delete the older copy in Mods.`,
  },
  {
    test: /Mixin apply(?:ing)? (?:failed|for mod ([\w-]+) failed)|MixinApplyError|InvalidInjectionException.*?from mod ([\w-]+)|from mod ([\w-]+) failed injection check/i,
    title: "A mod doesn't work with this Minecraft version",
    text: (m) => {
      const mod = m[1] || m[2] || m[3];
      return `${mod ? `“${mod}”` : "A mod"} tried to change part of the game that is different in Minecraft 1.21.11. Update it, or turn it off in Mods.`;
    },
  },
  {
    test: /UnsupportedClassVersionError|class file version (\d+)/,
    title: "A mod needs a newer Java",
    text: () => "Something was built for a newer Java than the game runs on. It's usually a mod made for a newer Minecraft version: check that every mod is for 1.21.11.",
  },
  {
    test: /Pixel format not accelerated|WGL: The driver does not appear to support OpenGL|GLFW error 65542|OpenGL 3\.2 is not supported|No OpenGL context/i,
    title: "Graphics driver problem",
    text: () => "Your graphics driver can't run Minecraft's OpenGL. Update the driver from NVIDIA / AMD / Intel, and on laptops make sure Java uses the dedicated GPU (Windows Graphics settings).",
  },
  {
    test: /EXCEPTION_ACCESS_VIOLATION|# A fatal error has been detected by the Java Runtime Environment/,
    title: "Java itself crashed",
    text: () => "The crash happened below Minecraft (in a driver or native library). Updating your graphics driver fixes this most of the time; overlays (Discord, Afterburner, RivaTuner) can also cause it.",
  },
  {
    test: /net\.irisshaders|iris.*(?:shader|compile)|Shader compilation failed|Couldn't compile shader/i,
    title: "Shader pack problem",
    text: () => "A shader pack failed. Turn shaders off (Options → Video → Shader Packs) or try another pack / a newer version of it.",
  },
  {
    test: /sodium.*(?:incompatible|crash)|me\.jellysquid\.mods\.sodium|net\.caffeinemc/i,
    title: "Sodium is involved",
    text: () => "The crash goes through Sodium. Update Sodium and the mods that add on to it (Iris, Indium …) together.",
    level: "info",
  },
  {
    test: /Failed to load native library|UnsatisfiedLinkError|lwjgl.*(?:native|\.dll)/i,
    title: "A game file is broken",
    text: () => "A native library couldn't load. Use Settings → Repair to download the game files again.",
  },
  {
    test: /java\.util\.zip\.ZipException|Zip file is invalid|invalid LOC header|error in opening zip file/i,
    title: "A broken jar file",
    text: () => "A mod or game file is damaged (often an interrupted download). Re-download the newest mod in Mods, or use Settings → Repair.",
  },
  {
    test: /Address already in use|Failed to bind to port/i,
    title: "Port already in use",
    text: () => "Another program (or another Minecraft) is using the port. Close it and try again.",
    level: "info",
  },
];

/** "Suspected Mods: X (x), Y (y)" lines and mod ids in "at modid.package" style stack frames. */
function suspects(text: string): string[] {
  const out = new Set<string>();
  const sm = text.match(/Suspected Mods?:\s*(.+)/);
  if (sm && !/None|Unknown/i.test(sm[1])) {
    for (const part of sm[1].split(",")) {
      const name = part.replace(/\(.*?\)/g, "").trim();
      if (name && !/^minecraft$|^java$|^fabric/i.test(name)) out.add(name);
    }
  }
  return [...out].slice(0, 4);
}

export function analyze(text: string): { description: string | null; findings: Finding[] } {
  const findings: Finding[] = [];
  for (const r of RULES) {
    const m = text.match(r.test);
    if (m) findings.push({ level: r.level ?? "fix", title: r.title, text: r.text(m), match: m[0] });
  }
  const sus = suspects(text);
  if (sus.length) {
    findings.push({
      level: findings.length ? "info" : "fix",
      title: "Mods that might be the cause",
      text: `The crash report points at: ${sus.join(", ")}. Try turning ${sus.length === 1 ? "it" : "them"} off in Mods, then play again.`,
    });
  }
  const desc = text.match(/^Description:\s*(.+)$/m)?.[1]?.trim() ?? null;
  if (!findings.length) {
    const ex = text.match(/^(?:Caused by: )?([a-zA-Z_$][\w.$]*(?:Exception|Error))(?::\s*(.{0,160}))?/m);
    findings.push({
      level: "info",
      title: ex ? "No known cause found" : "Nothing obvious in this file",
      text: ex
        ? `The error is ${ex[1].split(".").pop()}${ex[2] ? `: “${ex[2].trim()}”` : ""}. If you added mods recently, turn the newest ones off and try again.`
        : "This file doesn't show a crash. Pick the crash report from the time it happened.",
      match: ex?.[0],
    });
  }
  return { description: desc, findings };
}

/** Lines worth highlighting in the viewer. */
export function important(line: string): "error" | "cause" | "mod" | null {
  if (/^\s*Caused by:|^Description:|Exception|Error:/.test(line)) return /^\s*Caused by:/.test(line) ? "cause" : "error";
  if (/Suspected Mods?:|from mod |\[.*?FATAL|\bERROR\b/.test(line)) return "mod";
  return null;
}

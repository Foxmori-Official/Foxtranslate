// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import {
  UI_LANGS,
  normalizeUiLang,
  resolveUiLang,
  t,
} from "../../src/shared/i18n";
import { TRANSLATION_STYLES } from "../../src/core/styles";
import { BUILTIN_EXPERTS } from "../../src/core/experts";
import { BUILTIN_ENGINES } from "../../src/shared/engines";
import { DEFAULT_CONFIG, normalizeConfig } from "../../src/shared/config";
import type { Config } from "../../src/shared/config";

// ===== EN 字典键集合（与 src/shared/i18n.ts 中 EN 字典一一对应，） =====

const EXPECTED_KEYS = [
  "style.soft-gray",
  "style.underline-dotted",
  "style.highlight-yellow",
  "style.highlight-green",
  "style.blur-mask",
  "settings",
  "lang.autoDetect",
  "lang.commonGroup",
  "lang.allGroup",
  "brand.settings",
  "sel.title",
  "sel.defaultEngine",
  "sel.ai",
  "sel.save",
  "sel.speak",
  "sel.stop",
  "sel.copy",
  "sel.close",
  "sel.translating",
  "sel.translateFailed",
  "sel.copied",
  "sel.copyFailed",
  "sel.savedWord",
  "sel.ttsUnavailable",
  "sel.aiThinking",
  "sel.aiFollowPh",
  "sel.aiBusy",
  "sel.aiSend",
  "sel.aiRequestFailed",
  "ball.tip",
  "input.replaced",
  "input.replaceFailed",
  "render.loading",
  "render.retry",
  "cmp.targetLang",
  "cmp.engineFailed",
  "cmp.runFailed",
  "sel.aiUnavailable",
  "sel.saveFailed",
  "cmp.title",
  "cmp.close",
  "cmp.placeholder",
  "cmp.run",
  "cmp.hint",
  "cmp.engine.google",
  "cmp.engine.bing",
  "cmp.engine.openai",
  "cmp.engine.custom",
  "engine.foxmori",
  "engine.foxmoriDesc",
  "engine.google",
  "engine.googleDesc",
  "engine.bing",
  "engine.bingDesc",
  "engine.mymemory",
  "engine.mymemoryDesc",
  "engine.deepl",
  "engine.deeplDesc",
  "engine.openai",
  "engine.openaiDesc",
  "engine.deepseek",
  "engine.deepseekDesc",
  "engine.claude",
  "engine.claudeDesc",
  "engine.gemini",
  "engine.geminiDesc",
  "engine.libretranslate",
  "engine.libretranslateDesc",
  "engine.getApiKey",
  "engine.foxmoriKeyPh",
  "opt.s1",
  "opt.s2",
  "opt.s3",
  "opt.s4",
  "opt.s5",
  "opt.s6",
  "opt.s7",
  "opt.s8",
  "opt.s9",
  "opt.s10",
  "opt.s11",
  "opt.s12",
  "opt.s13",
  "opt.s14",
  "opt.s15",
  "opt.s16",
  "opt.s17",
  "opt.s18",
  "opt.s19",
  "opt.s20",
  "opt.s21",
  "opt.s22",
  "opt.s23",
  "opt.s24",
  "opt.s25",
  "opt.s26",
  "opt.s27",
  "opt.s28",
  "opt.s29",
  "opt.s30",
  "opt.s31",
  "opt.s32",
  "opt.s33",
  "opt.s34",
  "opt.s35",
  "opt.s36",
  "opt.s37",
  "opt.s38",
  "opt.s39",
  "opt.s40",
  "opt.s41",
  "opt.s42",
  "opt.s43",
  "opt.s44",
  "opt.s45",
  "opt.s46",
  "opt.s47",
  "opt.s48",
  "opt.s49",
  "opt.s50",
  "opt.s51",
  "opt.s52",
  "opt.s53",
  "opt.s54",
  "opt.s55",
  "opt.s56",
  "opt.s57",
  "opt.s58",
  "opt.s59",
  "opt.s60",
  "opt.s61",
  "opt.s62",
  "opt.s63",
  "opt.s64",
  "opt.s65",
  "opt.s66",
  "opt.s67",
  "opt.s68",
  "opt.s69",
  "opt.s70",
  "opt.s71",
  "opt.s72",
  "opt.s73",
  "opt.s74",
  "opt.s75",
  "opt.s76",
  "opt.s77",
  "opt.s78",
  "opt.s79",
  "opt.s80",
  "opt.s81",
  "opt.s82",
  "opt.s83",
  "opt.s84",
  "opt.s85",
  "opt.s86",
  "opt.s87",
  "opt.s88",
  "opt.s89",
  "opt.s90",
  "opt.s91",
  "opt.s92",
  "opt.s93",
  "opt.s94",
  "opt.s95",
  "opt.s96",
  "opt.s97",
  "opt.s98",
  "opt.s99",
  "opt.s100",
  "opt.s101",
  "opt.s102",
  "opt.s103",
  "opt.s104",
  "opt.s105",
  "opt.s106",
  "opt.s107",
  "opt.s108",
  "opt.s109",
  "opt.s110",
  "opt.s111",
  "opt.s112",
  "opt.s113",
  "opt.s114",
  "opt.s115",
  "opt.s116",
  "opt.s117",
  "opt.s118",
  "opt.s119",
  "opt.s120",
  "opt.s121",
  "opt.s122",
  "opt.s123",
  "opt.s124",
  "opt.s125",
  "opt.s126",
  "opt.s127",
  "opt.s128",
  "opt.s129",
  "opt.s130",
  "opt.s131",
  "opt.s132",
  "opt.s133",
  "opt.s134",
  "opt.s135",
  "opt.s136",
  "opt.s137",
  "opt.s138",
  "opt.experts.s1",
  "opt.experts.s2",
  "opt.experts.s3",
  "opt.experts.s4",
  "opt.experts.s5",
  "opt.experts.s6",
  "opt.experts.s7",
  "opt.experts.s8",
  "opt.experts.s9",
  "opt.experts.s10",
  "opt.experts.s11",
  "opt.experts.s12",
  "opt.experts.s13",
  "opt.experts.s14",
  "opt.experts.s15",
  "opt.experts.s16",
  "opt.experts.s17",
  "opt.experts.s18",
  "opt.experts.s19",
  "opt.experts.s20",
  "opt.experts.s21",
  "opt.experts.s22",
  "opt.experts.s23",
  "opt.experts.s24",
  "opt.experts.s25",
  "opt.experts.s26",
  "opt.glossaryLibs.s1",
  "opt.glossaryLibs.s2",
  "opt.glossaryLibs.s3",
  "opt.glossaryLibs.s4",
  "opt.glossaryLibs.s5",
  "opt.glossaryLibs.s6",
  "opt.glossaryLibs.s7",
  "opt.glossaryLibs.s8",
  "opt.glossaryLibs.s9",
  "opt.glossaryLibs.s10",
  "opt.glossaryLibs.s11",
  "opt.glossaryLibs.s12",
  "opt.glossaryLibs.s13",
  "opt.glossaryLibs.s14",
  "opt.glossaryLibs.s15",
  "opt.glossaryLibs.s16",
  "opt.glossaryLibs.s17",
  "opt.glossaryLibs.s18",
  "opt.glossaryLibs.s19",
  "opt.glossaryLibs.s20",
  "opt.glossaryLibs.s21",
  "opt.glossaryLibs.s22",
  "opt.glossaryLibs.s23",
  "opt.glossaryLibs.s24",
  "opt.glossaryLibs.s25",
  "opt.glossaryLibs.s26",
  "opt.glossaryLibs.s27",
  "opt.glossaryLibs.s28",
  "opt.glossaryLibs.s29",
  "opt.glossaryLibs.s30",
  "opt.glossaryLibs.s31",
  "opt.glossaryLibs.s32",
  "opt.glossaryLibs.s33",
  "opt.glossaryLibs.s34",
  "opt.glossaryLibs.s35",
  "opt.glossaryLibs.s36",
  "opt.glossaryLibs.s37",
  "opt.glossaryLibs.s38",
  "opt.hotkeys.s1",
  "opt.hotkeys.s2",
  "opt.hotkeys.s3",
  "opt.hotkeys.s4",
  "opt.hotkeys.s5",
  "opt.hotkeys.s6",
  "opt.hotkeys.s7",
  "opt.hotkeys.s8",
  "opt.hotkeys.s9",
  "opt.hotkeys.s10",
  "opt.hotkeys.s11",
  "opt.hotkeys.s12",
  "opt.hotkeys.s13",
  "opt.hotkeys.s14",
  "opt.tts.s1",
  "opt.tts.s2",
  "opt.tts.s3",
  "opt.tts.s4",
  "opt.tts.s5",
  "opt.tts.s6",
  "opt.tts.s7",
  "opt.tts.s8",
  "opt.tts.s9",
  "opt.tts.s10",
  "opt.tts.s11",
  "opt.tts.s12",
  "opt.tts.s13",
  "opt.tts.s14",
  "opt.tts.s15",
  "opt.tts.s16",
  "opt.tts.s17",
  "opt.tts.s18",
  "opt.tts.s19",
  "opt.tts.s20",
  "opt.tts.s21",
  "opt.tts.s22",
  "pop.s1",
  "pop.s2",
  "pop.s3",
  "files.s1",
  "files.s2",
  "files.s3",
  "files.s4",
  "files.s5",
  "files.s6",
  "files.s7",
  "files.s8",
  "files.s9",
  "files.s10",
  "files.s11",
  "files.s12",
  "files.s13",
  "files.s14",
  "files.s15",
  "ob.s1",
  "ob.s2",
  "ob.s3",
  "ob.s4",
  "ob.s5",
  "ob.s6",
  "ob.s7",
  "ob.s8",
  "style.plain",
  "style.bold",
  "style.italic",
  "style.card",
  "style.rounded",
  "style.quote",
  "style.gradient",
  "style.frosted",
  "expert.general",
  "expert.tech",
  "expert.literary",
  "expert.academic",
  "expert.social",
  "save",
  "saved",
  "cancel",
  "delete",
  "edit",
  "add",
  "test",
  "testing",
  "popup.translatePage",
  "popup.restorePage",
  "popup.targetLang",
  "popup.sourceLang",
  "popup.displayMode",
  "popup.bilingual",
  "popup.translationOnly",
  "popup.expert",
  "popup.style",
  "popup.engine",
  "popup.hover",
  "popup.selection",
  "popup.floatingBall",
  "popup.currentSite",
  "popup.alwaysSite",
  "popup.neverSite",
  "popup.pageUnavailable",
  "popup.files",
  "popup.review",
  "popup.tutorial",
  "nav.guide",
  "nav.privacy",
  "popup.openSettings",
  "popup.statusLoading",
  "popup.statusIdle",
  "popup.statusTranslated",
  "popup.statusTranslatedFail",
  "popup.opFailed",
  "popup.loadFailed",
  "popup.commonLangs",
  "popup.allLangs",
  "popup.expertBuiltin",
  "popup.expertCustom",
  "popup.stats",
  "popup.statsEmpty",
  "tab.general",
  "tab.engine",
  "tab.experts",
  "tab.style",
  "tab.privacy",
  "tab.glossary",
  "tab.glossaryLibs",
  "tab.tts",
  "tab.words",
  "tab.interaction",
  "tab.hotkeys",
  "tabDesc.general",
  "tabDesc.engine",
  "tabDesc.experts",
  "tabDesc.style",
  "tabDesc.privacy",
  "tabDesc.glossary",
  "tabDesc.glossaryLibs",
  "tabDesc.tts",
  "tabDesc.hotkeys",
  "tabDesc.words",
  "tabDesc.interaction",
  "general.uiLang",
  "general.uiLangAuto",
  "general.uiLangDesc",
  "general.targetLang",
  "general.targetLangDesc",
  "general.displayMode",
  "general.displayModeDesc",
  "general.bilingual",
  "general.bilingualDesc",
  "general.translationOnly",
  "general.translationOnlyDesc",
  "general.autoSites",
  "general.autoSitesDesc",
  "general.autoLangs",
  "general.autoLangsDesc",
  "general.neverSites",
  "general.neverSitesDesc",
  "general.domainPlaceholder",
];

describe("界面语言解析", () => {
  it("显式中英文覆盖浏览器语言", () => {
    expect(resolveUiLang("en", "zh-HK")).toBe("en");
    expect(resolveUiLang("zh-CN", "en-US")).toBe("zh-CN");
  });

  it("跟随系统时中文系统使用中文，其他系统使用英文", () => {
    for (const lang of ["zh-CN", "zh-HK", "zh-Hant-TW"]) {
      expect(resolveUiLang("auto", lang)).toBe("zh-CN");
    }
    for (const lang of ["en-US", "ja-JP", "de-DE", "fr-CA", "pt-BR", "ko-KR"]) {
      expect(resolveUiLang("auto", lang)).toBe("en");
    }
  });

  it("界面语言不影响翻译语种", () => {
    const config = normalizeConfig({ uiLang: "en", general: { sourceLang: "fr", targetLang: "ja" } });
    expect(config.uiLang).toBe("en");
    expect(config.general).toMatchObject({ sourceLang: "fr", targetLang: "ja" });
    expect(normalizeConfig({ uiLang: "auto" }).uiLang).toBe("auto");
  });

  it("只接受三个配置值，无效值使用默认设置", () => {
    expect(normalizeUiLang("auto")).toBe("auto");
    expect(normalizeUiLang("en")).toBe("en");
    expect(normalizeUiLang("zh-CN")).toBe("zh-CN");
    expect(normalizeUiLang("unsupported")).toBe("auto");
    expect(normalizeConfig({ uiLang: "unsupported" }).uiLang).toBe("auto");
  });

  it("英文词条齐全，中文使用源码文案", () => {
    expect(UI_LANGS.map(l => l.code)).toEqual(["auto", "en", "zh-CN"]);
    const keys = [
      ...EXPECTED_KEYS,
      ...TRANSLATION_STYLES.map(s => s.nameKey),
      ...BUILTIN_EXPERTS.flatMap(e => e.nameKey ? [e.nameKey] : []),
      ...BUILTIN_ENGINES.flatMap(e => e.descKey ? [e.nameKey, e.descKey] : [e.nameKey]),
    ];
    for (const key of keys) {
      expect(t(key, "en", "MISSING"), key).not.toBe("MISSING");
    }
    expect(t("popup.stats", "en", "")).toContain("{w}");
    expect(t("popup.stats", "en", "")).toContain("{d}");
    expect(t("tab.general", "zh-CN", "通用")).toBe("通用");
  });
});

// ===== 通用页「界面语言」下拉（DOM） =====

let stored: Config;

function installChromeStub(): void {
  const sendMessage = vi.fn(
    async (msg: { kind: string; patch?: Partial<Config> }) => {
      if (msg.kind === "getConfig") return { ok: true, data: stored };
      if (msg.kind === "setConfig") {
        // background store 为浅合并：patch 中的嵌套对象总是整对象传入
        stored = { ...stored, ...msg.patch };
        return { ok: true, data: stored };
      }
      return { ok: true, data: null };
    },
  );
  (globalThis as Record<string, unknown>).chrome = {
    runtime: {
      getManifest: () => ({ version: '0.0.6' }),
      sendMessage,
      getURL: (p: string) => `chrome-extension://mock/${p}`,
    },
    permissions: {
      contains: async () => true,
      request: async () => true,
    },
  };
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

function setNavigatorLanguage(lang: string): void {
  Object.defineProperty(window.navigator, "language", {
    value: lang,
    configurable: true,
  });
}

/** 全新模块 + DOM + chrome stub 启动设置页（默认落在「通用」标签页） */
async function boot(cfg: Config, browserLang = "zh-CN"): Promise<void> {
  setNavigatorLanguage(browserLang);
  stored = cfg;
  installChromeStub();
  document.body.innerHTML = '<div id="app"></div>';
  vi.resetModules();
  await import("../../src/options/main");
  await flush();
}

function qs<T extends Element>(sel: string, root: ParentNode = document): T {
  const node = root.querySelector<T>(sel);
  if (!node) throw new Error(`未找到元素：${sel}`);
  return node;
}

function cardByTitle(title: string): HTMLElement {
  const card = Array.from(
    document.querySelectorAll<HTMLElement>(".content > .card"),
  ).find((c) => c.querySelector(".card-title")?.textContent === title);
  if (!card) {
    const field = Array.from(document.querySelectorAll<HTMLElement>('.field')).find(row => row.querySelector('.field-label')?.textContent === title)
    if (field) return field
  }
  if (!card) throw new Error(`未找到卡片：${title}`);
  return card;
}

function navLabels(): string[] {
  return Array.from(document.querySelectorAll(".nav-btn")).map(
    (b) => b.textContent ?? "",
  );
}

describe("通用页界面语言下拉", () => {
  it("只提供跟随系统、英文和简体中文", async () => {
    await boot(structuredClone(DEFAULT_CONFIG));
    const select = qs<HTMLSelectElement>("select.control", cardByTitle("界面语言"));
    expect(Array.from(select.options, o => o.value)).toEqual(["auto", "en", "zh-CN"]);
    expect(Array.from(select.options, o => o.textContent)).toEqual(["跟随系统", "English", "简体中文"]);
    expect(select.value).toBe("auto");
    expect(navLabels()[0]).toBe("通用");
  });

  it("切换英文后保存并立即重渲染，再切回中文", async () => {
    await boot(structuredClone(DEFAULT_CONFIG));
    const select = qs<HTMLSelectElement>("select.control", cardByTitle("界面语言"));
    select.value = "en";
    select.dispatchEvent(new Event("change"));
    await flush();
    expect(stored.uiLang).toBe("en");
    expect(navLabels()[0]).toBe("General");
    const englishSelect = qs<HTMLSelectElement>("select.control", cardByTitle("Interface language"));
    expect(englishSelect.value).toBe("en");
    englishSelect.value = "zh-CN";
    englishSelect.dispatchEvent(new Event("change"));
    await flush();
    expect(stored.uiLang).toBe("zh-CN");
    expect(navLabels()[0]).toBe("通用");
  });
});

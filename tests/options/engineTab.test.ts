/**
 * @vitest-environment jsdom
 *
 * 翻译服务列表与详情集成测试：
 * - 查看引擎配置和测试连接，显式设为当前引擎（foxmori / deepl / custom:<id>）
 * - 添加自定义引擎（模板预填、保存后自动设为当前引擎）
 * - 高级设置（可选）默认收起，headersJson 保存进配置
 * - 「删除此引擎」在表单内完成，删除当前引擎后回退 Foxmori
 *
 * main.ts 在 document 存在时自动 init()，因此每个用例先装 chrome stub 再动态 import。
 */
import { describe, it, expect, vi } from "vitest";
import { DEFAULT_CONFIG } from "../../src/shared/config";
import type { Config, CustomEngine } from "../../src/shared/config";

let stored: Config;

function installChromeStub(): void {
  const sendMessage = vi.fn(async (msg: { kind: string; provider?: string; patch?: Partial<Config> }) => {
    if (msg.kind === "getConfig") return { ok: true, data: stored };
    if (msg.kind === "setConfig") {
      // background store 为浅合并：patch 中的嵌套对象总是整对象传入
      stored = { ...stored, ...msg.patch };
      return { ok: true, data: stored };
    }
    if (msg.kind === "testEngine") {
      return {
        ok: true,
        data: { ok: true, text: "你好", engine: msg.provider ?? stored.engine.provider, elapsedMs: 12 },
      };
    }
    return { ok: true, data: null };
  });
  (globalThis as Record<string, unknown>).chrome = {
    runtime: {
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

/** 全新模块 + DOM + chrome stub 启动设置页，并切到「翻译引擎」标签页 */
async function bootEngineTab(cfg: Config): Promise<void> {
  cfg.uiLang = cfg.uiLang === 'auto' ? 'zh-CN' : cfg.uiLang;
  stored = cfg;
  installChromeStub();
  document.body.innerHTML = '<div id="app"></div>';
  vi.resetModules();
  await import("../../src/options/main");
  await flush();
  qs<HTMLButtonElement>('[data-tab="engine"]').click();
  await flush();
}

function qs<T extends Element>(sel: string, root: ParentNode = document): T {
  const node = root.querySelector<T>(sel);
  if (!node) throw new Error(`未找到元素：${sel}`);
  return node;
}

function btnByText(text: string, root: ParentNode = document): HTMLButtonElement {
  const btn = Array.from(root.querySelectorAll("button")).find(
    (b) => b.textContent === text,
  );
  if (!btn) throw new Error(`未找到按钮：${text}`);
  return btn;
}

function cfgWithCustomEngine(): Config {
  const cfg = structuredClone(DEFAULT_CONFIG);
    cfg.uiLang = 'zh-CN'; // 测试断言中文界面：显式中文（默认 auto 在测试环境解析为英文）
  const entry: CustomEngine = {
    id: "abc123",
    name: "我的引擎",
    endpoint: "https://api.example.com/v1",
    apiKey: "sk-x",
    model: "m1",
    headersJson: '{"X-A":"1"}',
  };
  cfg.engine.customEngines = [entry];
  cfg.engine.provider = "custom:abc123";
  return cfg;
}

describe("翻译引擎标签页", () => {
  it.each(['zh-CN', 'en'] as const)("%s exposes, bounds and saves concurrency independently of batching", async lang => {
    const cfg = structuredClone(DEFAULT_CONFIG);
    cfg.uiLang = lang;
    cfg.batch.enabled = false;
    await bootEngineTab(cfg);
    const label = lang === 'en' ? 'Concurrent requests' : '并发请求数';
    const input = () => qs<HTMLInputElement>(`input[aria-label="${label}"]`);
    expect(input().min).toBe('1');
    expect(input().max).toBe('8');
    expect(input().value).toBe('3');
    for (const [raw, expected] of [['20', 8], ['0', 1], ['5.9', 5]] as const) {
      input().value = raw;
      input().dispatchEvent(new Event('change'));
      await flush();
      expect(stored.batch.concurrency).toBe(expected);
      expect(input().value).toBe(String(expected));
      expect(stored.batch.enabled).toBe(false);
    }
    input().value = '';
    input().dispatchEvent(new Event('change'));
    await flush();
    expect(input().value).toBe('5');
    expect(stored.batch.concurrency).toBe(5);
  });

  it("左侧按服务分组，右侧显示当前引擎的配置和测试", async () => {
    const cfg = structuredClone(DEFAULT_CONFIG);
    cfg.uiLang = 'zh-CN'; // 测试断言中文界面：显式中文（默认 auto 在测试环境解析为英文）
    cfg.engine.provider = "foxmori";
    await bootEngineTab(cfg);

    const cards = document.querySelectorAll(".content > .card");
    expect(cards.length).toBe(2);
    const engineCard = cards[0];
    expect(Array.from(engineCard.querySelectorAll(".engine-group-title"), el => el.textContent)).toEqual([
      "免费 · 无需密钥", "Foxmori 订阅", "自备密钥与自定义",
    ]);
    expect(engineCard.querySelectorAll(".engine-current")).toHaveLength(1);
    expect(engineCard.querySelector('[data-engine-id="foxmori"] .engine-current')?.textContent).toBe("当前");
    expect(engineCard.querySelector(".engine-config")).toBeTruthy();
    expect(btnByText("测试连接", engineCard)).toBeTruthy();
    // Foxmori配置字段在统一卡片内
    const area = qs<HTMLElement>(".engine-config", engineCard);
    expect(area.textContent).toContain("https://api.foxmori.com/v1");
    expect(area.textContent).toContain("API Key");
    expect(btnByText("登录 Foxmori", area)).toBeTruthy();
    expect(btnByText("获取模型列表", area)).toBeTruthy();
  });

  it("浏览及测试 DeepL 不切换默认引擎，显式设为当前后才写入 provider", async () => {
    const cfg = structuredClone(DEFAULT_CONFIG);
    cfg.uiLang = 'zh-CN'; // 测试断言中文界面：显式中文（默认 auto 在测试环境解析为英文）
    cfg.engine.provider = "foxmori";
    await bootEngineTab(cfg);

    qs<HTMLButtonElement>('[data-engine-id="deepl"]').click();

    expect(stored.engine.provider).toBe("foxmori");
    const area = qs<HTMLElement>(".engine-config");
    expect(area.textContent).toContain("API Key");
    expect(area.textContent).toContain("密钥仅保存在本机浏览器中");
    btnByText("测试连接").click();
    await flush();
    expect(qs(".engine-test-result").textContent).toContain("deepl");
    expect(stored.engine.provider).toBe("foxmori");

    btnByText("设为当前引擎").click();
    await flush();
    expect(stored.engine.provider).toBe("deepl");
    expect(qs('[data-engine-id="deepl"] .engine-current').textContent).toBe("当前");
  });

  it("选中 custom:<id> 时配置区直接显示该引擎编辑表单（含删除入口），高级区默认收起", async () => {
    await bootEngineTab(cfgWithCustomEngine());

    const area = qs<HTMLElement>(".engine-config");
    const form = qs<HTMLElement>(".custom-engine-form", area);
    expect(
      qs<HTMLInputElement>('input[placeholder="引擎名称"]', form).value,
    ).toBe("我的引擎");
    expect(
      qs<HTMLInputElement>('input[placeholder="https://api.example.com/v1"]', form)
        .value,
    ).toBe("https://api.example.com/v1");
    expect(btnByText("保存", form)).toBeTruthy();
    expect(btnByText("删除此引擎", form)).toBeTruthy();
    expect(btnByText("获取模型列表", form)).toBeTruthy();

    // 高级设置（可选）：<details> 默认收起，headersJson 收在其中
    const details = qs<HTMLDetailsElement>("details.engine-advanced", form);
    expect(details.open).toBe(false);
    expect(qs<HTMLElement>("summary", details).textContent).toBe("高级设置（可选）");
    expect(details.textContent).toContain("一般无需填写，仅当接口需要额外请求头时使用");
    expect(qs<HTMLTextAreaElement>("textarea", details).value).toBe('{"X-A":"1"}');
    // 请求头字段不再裸露在高级区之外
    expect(form.querySelector(":scope > .field-top")).toBeNull();
  });

  it("编辑自定义引擎：高级区内修改 headersJson 保存进配置", async () => {
    await bootEngineTab(cfgWithCustomEngine());

    const form = qs<HTMLElement>(".custom-engine-form");
    const details = qs<HTMLDetailsElement>("details.engine-advanced", form);
    details.open = true; // 用户展开高级区
    const textarea = qs<HTMLTextAreaElement>("textarea", details);
    textarea.value = '{"X-New":"abc"}';
    btnByText("保存", form).click();
    await flush();

    expect(stored.engine.customEngines.length).toBe(1);
    expect(stored.engine.customEngines[0].headersJson).toBe('{"X-New":"abc"}');
    expect(stored.engine.provider).toBe("custom:abc123");
  });

  it("headersJson 非法 JSON 时拦截保存并提示", async () => {
    await bootEngineTab(cfgWithCustomEngine());

    const form = qs<HTMLElement>(".custom-engine-form");
    const textarea = qs<HTMLTextAreaElement>("details.engine-advanced textarea", form);
    textarea.value = "not-json";
    btnByText("保存", form).click();
    await flush();

    expect(stored.engine.customEngines[0].headersJson).toBe('{"X-A":"1"}');
    const hints = Array.from(form.querySelectorAll(".hint")).map((h) => h.textContent);
    expect(hints).toContain("请求头 JSON 格式不正确");
  });

  it("添加自定义引擎：展开新建表单，保存后自动设为当前引擎", async () => {
    const cfg = structuredClone(DEFAULT_CONFIG);
    cfg.uiLang = 'zh-CN'; // 测试断言中文界面：显式中文（默认 auto 在测试环境解析为英文）
    cfg.engine.provider = "foxmori";
    await bootEngineTab(cfg);

    const addItem = qs<HTMLButtonElement>(".engine-add");
    expect(addItem.textContent).toBe("添加自定义引擎");
    addItem.click();
    await flush();

    // 伪选项不写入 provider
    expect(stored.engine.provider).toBe("foxmori");
    const form = qs<HTMLElement>(".custom-engine-form");
    // 模板预填
    expect(qs<HTMLInputElement>('input[placeholder="引擎名称"]', form).value).toBe(
      "我的引擎",
    );
    const details = qs<HTMLDetailsElement>("details.engine-advanced", form);
    expect(details.open).toBe(false);
    expect(qs<HTMLTextAreaElement>("textarea", details).value).toBe("{}");

    // 填写名称 + Endpoint 后添加
    qs<HTMLInputElement>('input[placeholder="引擎名称"]', form).value = "测试引擎";
    qs<HTMLInputElement>(
      'input[placeholder="https://api.example.com/v1"]',
      form,
    ).value = "https://api.test.com/v1";
    btnByText("添加", form).click();
    await flush();

    expect(stored.engine.customEngines.length).toBe(1);
    const entry = stored.engine.customEngines[0];
    expect(entry).toMatchObject({
      name: "测试引擎",
      endpoint: "https://api.test.com/v1",
      headersJson: "{}",
    });
    // 保存后自动设为当前引擎，配置区联动为该引擎的编辑表单
    expect(stored.engine.provider).toBe(`custom:${entry.id}`);
    expect(qs<HTMLElement>(".custom-engine-form")).toBeTruthy();
    expect(btnByText("删除此引擎")).toBeTruthy();
  });

  it("新建表单可取消：取消后回到当前引擎配置，不产生新引擎", async () => {
    const cfg = structuredClone(DEFAULT_CONFIG);
    cfg.uiLang = 'zh-CN'; // 测试断言中文界面：显式中文（默认 auto 在测试环境解析为英文）
    cfg.engine.provider = "foxmori";
    await bootEngineTab(cfg);

    qs<HTMLButtonElement>(".engine-add").click();
    await flush();
    btnByText("取消", qs<HTMLElement>(".custom-engine-form")).click();
    await flush();

    expect(stored.engine.customEngines.length).toBe(0);
    expect(stored.engine.provider).toBe("foxmori");
    expect(document.querySelector(".custom-engine-form")).toBeNull();
    expect(qs<HTMLElement>(".engine-config").textContent).toContain(
      "https://api.foxmori.com/v1",
    );
  });

  it("「删除此引擎」：从表单内删除当前自定义引擎并回退到 Foxmori", async () => {
    await bootEngineTab(cfgWithCustomEngine());

    btnByText("删除此引擎", qs<HTMLElement>(".custom-engine-form")).click();
    await flush();

    expect(stored.engine.customEngines.length).toBe(0);
    expect(stored.engine.provider).toBe("foxmori");
    // 配置区联动回 Foxmori
    expect(qs<HTMLElement>(".engine-config").textContent).toContain(
      "https://api.foxmori.com/v1",
    );
  });

  it("免费引擎（google）配置区显示开箱即用提示", async () => {
    const cfg = structuredClone(DEFAULT_CONFIG);
    cfg.uiLang = 'zh-CN'; // 测试断言中文界面：显式中文（默认 auto 在测试环境解析为英文）
    cfg.engine.provider = "google";
    await bootEngineTab(cfg);

    expect(qs<HTMLElement>(".engine-config").textContent).toContain(
      "该引擎开箱即用，无需配置。",
    );
  });

  it("测试连接按钮保留在统一卡片底部并回报结果", async () => {
    const cfg = structuredClone(DEFAULT_CONFIG);
    cfg.uiLang = 'zh-CN'; // 测试断言中文界面：显式中文（默认 auto 在测试环境解析为英文）
    cfg.engine.provider = "foxmori";
    await bootEngineTab(cfg);

    const engineCard = document.querySelectorAll(".content > .card")[0];
    btnByText("测试连接", engineCard).click();
    await flush();

    const result = qs<HTMLElement>(".engine-test-result", engineCard);
    expect(result.textContent).toContain("连接成功");
    expect(result.textContent).toContain("你好");
  });
});

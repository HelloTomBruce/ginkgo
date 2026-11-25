<script setup lang="ts">
const GITHUB_URL = "https://github.com/HelloTomBruce/ginkgo";

const layers = [
  {
    id: "L4",
    name: "宿主壳 src/",
    tech: "Next.js 16 · React 19",
    desc: "装配组合根 + 通用 UI 框架 + API 薄壳，零应用领域语义",
  },
  {
    id: "L3",
    name: "应用包 packages/apps/*",
    tech: "数据分析 · 体验设计 · 通用助手",
    desc: "领域语义全自持：prompt / 工具 / 交付物 / 客户端插槽",
  },
  {
    id: "L2",
    name: "能力包 packages/ginkgo-*",
    tech: "sandbox · datasources · components · models",
    desc: "沙箱原子工具、只读数据网关、看板渲染基建、模型元数据",
  },
  {
    id: "L1",
    name: "编排层 ginkgo-llm",
    tech: "领域中立",
    desc: "streamText + 模型链韧性 + StreamHub 流中继 + 三维熔断 + 四接缝",
  },
  {
    id: "L0",
    name: "协议层 ginkgo-app-sdk",
    tech: "契约唯一事实来源",
    desc: "类型 + defineApp：client 插槽与 server 接缝的一切声明",
  },
];

const features = [
  {
    icon: "🧩",
    title: "可插拔应用体系",
    desc: "契约先行——一切扩展点在 app-sdk 声明。新应用接入零宿主改动，应用间经协议层类型解耦。",
  },
  {
    icon: "🗄️",
    title: "多数据源编排",
    desc: "PostgreSQL / MySQL / SQLite / ClickHouse / GitLab / 禅道 / 文件，全部只读双保险（词法守卫 + 引擎级只读）。",
  },
  {
    icon: "📊",
    title: "声明式看板 DSL",
    desc: "LLM 流式生成 DashboardSpec 2.0 状态树，24 种组件渐进渲染，RFC 6902 Patch 增量更新。",
  },
  {
    icon: "🛡️",
    title: "平台级 Agent 底座",
    desc: "模型链韧性、StreamHub 流中继、三维熔断、上下文投影治理、FinOps 成本台账。",
  },
  {
    icon: "🧭",
    title: "Plan-first 与人机审批",
    desc: "规划期权限档自动收敛只读，高危动作挂起审批卡片，副作用操作全程可控。",
  },
  {
    icon: "🤖",
    title: "多 Provider 模型治理",
    desc: "20+ 国内外预设、动态 models.dev 目录、连通性探针、推理模型识别与上下文容量规范。",
  },
];

const providers = [
  "DeepSeek",
  "OpenAI",
  "Anthropic",
  "Kimi",
  "智谱 GLM",
  "Qwen",
  "火山方舟",
  "Gemini",
  "xAI Grok",
  "Mistral",
  "Groq",
  "硅基流动",
  "OpenRouter",
  "Ollama",
];
</script>

<template>
  <div class="lp">
    <!-- ============ HERO ============ -->
    <section class="hero">
      <div class="hero-bg" aria-hidden="true">
        <div class="orb orb-a" />
        <div class="orb orb-b" />
        <div class="grid-overlay" />
      </div>

      <div class="hero-inner">
        <div class="hero-copy">
          <div class="hero-eyebrow">
            <span class="pulse-dot" />
            GINKGO AGENT PLATFORM
          </div>
          <h1 class="hero-title">
            智能体应用<br />的<mark class="grad-text">运行底座</mark>
          </h1>
          <p class="hero-tag">
            统一对话宿主 · 可插拔应用体系 · 平台级 Agent Harness<br />
            自然语言进，可交互看板出。
          </p>
          <div class="hero-actions">
            <a class="btn btn-primary" href="/ginkgo/guide/getting-started">
              快速开始
              <span class="btn-arrow">→</span>
            </a>
            <a class="btn btn-ghost" :href="GITHUB_URL" target="_blank" rel="noreferrer">
              <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden="true">
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"/>
              </svg>
              GitHub
            </a>
          </div>
          <div class="hero-stats">
            <div class="stat"><b>24</b><span>看板组件</span></div>
            <div class="stat"><b>20+</b><span>Provider 预设</span></div>
            <div class="stat"><b>7</b><span>数据源类型</span></div>
            <div class="stat"><b>1312</b><span>守护测试</span></div>
          </div>
        </div>

        <div class="hero-visual" aria-hidden="true">
          <div class="ring ring-1" />
          <div class="ring ring-2" />
          <div class="leaf-glow" />
          <img class="leaf" src="/logo-gold.svg" alt="Ginkgo 银杏叶" />
          <div class="orbit-chip chip-a">streamText</div>
          <div class="orbit-chip chip-b">DSL</div>
          <div class="orbit-chip chip-c">MCP</div>
        </div>
      </div>
    </section>

    <!-- ============ TERMINAL ============ -->
    <section class="section">
      <div class="section-head">
        <span class="kicker">QUICKSTART</span>
        <h2>三分钟跑起来</h2>
      </div>
      <div class="terminal">
        <div class="terminal-bar">
          <span class="t-dot t-r" /><span class="t-dot t-y" /><span class="t-dot t-g" />
          <span class="terminal-title">zsh — ginkgo</span>
        </div>
        <div class="terminal-body">
          <p><span class="t-prompt">➜</span> <span class="t-cmd">git clone</span> git@github.com:HelloTomBruce/ginkgo.git</p>
          <p><span class="t-prompt">➜</span> <span class="t-cmd">cd</span> ginkgo && <span class="t-cmd">pnpm install</span></p>
          <p><span class="t-prompt">➜</span> <span class="t-cmd">pnpm dev</span></p>
          <p class="t-out">▲ Next.js 16 ready on <span class="t-link">http://localhost:3006</span></p>
          <p class="t-out">✓ 设置中填入 API Key，开始对话<span class="cursor" /></p>
        </div>
      </div>
    </section>

    <!-- ============ ARCHITECTURE ============ -->
    <section class="section">
      <div class="section-head">
        <span class="kicker">ARCHITECTURE</span>
        <h2>壳 → 应用 → 能力 → 协议</h2>
        <p class="section-sub">分层与依赖方向恒为单向，逆向与跨层禁止。应用接入零宿主改动。</p>
      </div>
      <div class="layers">
        <div v-for="l in layers" :key="l.id" class="layer">
          <span class="layer-id">{{ l.id }}</span>
          <div class="layer-main">
            <div class="layer-name">{{ l.name }}</div>
            <div class="layer-tech">{{ l.tech }}</div>
          </div>
          <div class="layer-desc">{{ l.desc }}</div>
        </div>
      </div>
    </section>

    <!-- ============ FEATURES ============ -->
    <section class="section">
      <div class="section-head">
        <span class="kicker">CAPABILITIES</span>
        <h2>底座能力</h2>
      </div>
      <div class="cards">
        <div v-for="f in features" :key="f.title" class="card">
          <div class="card-icon">{{ f.icon }}</div>
          <h3>{{ f.title }}</h3>
          <p>{{ f.desc }}</p>
        </div>
      </div>
    </section>

    <!-- ============ PROVIDERS ============ -->
    <section class="section">
      <div class="section-head">
        <span class="kicker">MODELS</span>
        <h2>一个平台，接入所有主流模型</h2>
      </div>
      <div class="pills">
        <span v-for="p in providers" :key="p" class="pill">{{ p }}</span>
        <span class="pill pill-more">+ 自定义 OpenAI / Anthropic 兼容端点</span>
      </div>
    </section>

    <!-- ============ FINAL CTA ============ -->
    <section class="final">
      <div class="final-glow" aria-hidden="true" />
      <h2>现在就把第一个应用<br />接上底座</h2>
      <div class="hero-actions">
        <a class="btn btn-primary" href="/ginkgo/app-integration-guide">
          应用接入规范 <span class="btn-arrow">→</span>
        </a>
        <a class="btn btn-ghost" href="/ginkgo/guide/architecture">底座架构</a>
      </div>
    </section>
  </div>
</template>

<style scoped>
/* ============ 基础变量：银杏金 · 暖纸编辑风 ============ */
.lp {
  --lp-bg: oklch(96.8% 0.014 92);
  --lp-paper: oklch(98.6% 0.008 95);
  --lp-ink: oklch(24% 0.02 75);
  --lp-line: oklch(28% 0.02 75 / 0.14);
  --lp-text: oklch(24% 0.02 75);
  --lp-text-dim: oklch(38% 0.02 75 / 0.68);
  --lp-gold: oklch(68% 0.15 85);
  --lp-gold-deep: oklch(52% 0.12 76);
  --lp-gold-soft: oklch(88% 0.1 90);
  background: var(--lp-bg);
  color: var(--lp-text);
  font-feature-settings: "ss01", "cv11";
}

/* ============ HERO ============ */
.hero {
  position: relative;
  overflow: hidden;
  padding: 96px 24px 120px;
}

.hero-bg { position: absolute; inset: 0; pointer-events: none; }

.orb {
  position: absolute;
  border-radius: 50%;
  filter: blur(90px);
  animation: orbFloat 12s ease-in-out infinite alternate;
}
.orb-a {
  width: 520px; height: 520px;
  top: -180px; right: 6%;
  background: radial-gradient(circle, oklch(84% 0.11 88 / 0.6), transparent 70%);
}
.orb-b {
  width: 420px; height: 420px;
  bottom: -140px; left: 2%;
  background: radial-gradient(circle, oklch(88% 0.07 60 / 0.5), transparent 70%);
  animation-delay: -6s;
}

.grid-overlay {
  position: absolute; inset: 0;
  background-image:
    linear-gradient(var(--lp-line) 1px, transparent 1px),
    linear-gradient(90deg, var(--lp-line) 1px, transparent 1px);
  background-size: 56px 56px;
  opacity: 0.55;
  mask-image: radial-gradient(ellipse 75% 65% at 50% 38%, black 20%, transparent 75%);
}

.hero-inner {
  position: relative;
  max-width: 1152px;
  margin: 0 auto;
  display: grid;
  grid-template-columns: 1.15fr 0.85fr;
  gap: 48px;
  align-items: center;
}

.hero-eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-family: ui-monospace, "SF Mono", Menlo, monospace;
  font-size: 12px;
  letter-spacing: 0.18em;
  color: var(--lp-gold-deep);
  border: 1px solid oklch(52% 0.12 76 / 0.35);
  border-radius: 999px;
  padding: 6px 14px;
  background: oklch(68% 0.15 85 / 0.08);
}

.pulse-dot {
  width: 7px; height: 7px;
  border-radius: 50%;
  background: var(--lp-gold);
  box-shadow: 0 0 10px oklch(68% 0.15 85 / 0.8);
  animation: pulse 2.2s ease-in-out infinite;
}

.hero-title {
  margin: 24px 0 0;
  font-size: clamp(40px, 6vw, 68px);
  font-weight: 800;
  line-height: 1.08;
  letter-spacing: -0.02em;
  color: var(--lp-ink);
  border: none;
}

/* 编辑风「马克笔高亮」代替渐变文字 */
.grad-text {
  background: linear-gradient(100deg, oklch(84% 0.12 88 / 0.55), oklch(76% 0.14 86 / 0.65));
  color: var(--lp-ink);
  padding: 0 0.12em;
  border-radius: 6px;
  -webkit-box-decoration-break: clone;
  box-decoration-break: clone;
}

.hero-tag {
  margin-top: 20px;
  font-size: 17px;
  line-height: 1.75;
  color: var(--lp-text-dim);
}

.hero-actions { display: flex; gap: 14px; margin-top: 32px; flex-wrap: wrap; }

.btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 12px 24px;
  border-radius: 12px;
  font-size: 15px;
  font-weight: 600;
  text-decoration: none !important;
  transition: transform 0.2s, box-shadow 0.2s, border-color 0.2s, background 0.2s;
}
.btn-primary {
  color: var(--lp-paper) !important;
  background: var(--lp-ink);
  box-shadow: 0 10px 28px -10px oklch(24% 0.02 75 / 0.45);
}
.btn-primary:hover {
  transform: translateY(-2px);
  background: oklch(30% 0.025 75);
  box-shadow: 0 16px 40px -10px oklch(24% 0.02 75 / 0.5);
}
.btn-arrow { transition: transform 0.2s; }
.btn-primary:hover .btn-arrow { transform: translateX(4px); }

.btn-ghost {
  color: var(--lp-ink) !important;
  border: 1px solid oklch(28% 0.02 75 / 0.25);
  background: var(--lp-paper);
}
.btn-ghost:hover {
  border-color: oklch(28% 0.02 75 / 0.5);
  transform: translateY(-2px);
}

.hero-stats {
  display: flex;
  gap: 36px;
  margin-top: 48px;
  padding-top: 28px;
  border-top: 1px solid var(--lp-line);
}
.stat { display: flex; flex-direction: column; gap: 2px; }
.stat b {
  font-size: 26px;
  font-weight: 800;
  color: var(--lp-gold-deep);
  font-variant-numeric: tabular-nums;
}
.stat span { font-size: 12.5px; color: var(--lp-text-dim); }

/* Hero 视觉：双环 + 金叶 */
.hero-visual {
  position: relative;
  height: 420px;
  display: grid;
  place-items: center;
}
.ring {
  position: absolute;
  border-radius: 50%;
  border: 1px dashed oklch(52% 0.12 76 / 0.4);
  animation: spin 48s linear infinite;
}
.ring-1 { width: 300px; height: 300px; }
.ring-2 {
  width: 380px; height: 380px;
  border-style: solid;
  border-color: oklch(28% 0.02 75 / 0.12);
  animation-duration: 72s;
  animation-direction: reverse;
}
.leaf-glow {
  position: absolute;
  width: 260px; height: 260px;
  border-radius: 50%;
  background: radial-gradient(circle, oklch(82% 0.12 88 / 0.75), transparent 70%);
  filter: blur(36px);
  animation: pulse 4s ease-in-out infinite;
}
.leaf {
  position: relative;
  width: 190px;
  filter: drop-shadow(0 14px 32px oklch(55% 0.12 78 / 0.4));
  animation: leafFloat 6s ease-in-out infinite alternate;
}

.orbit-chip {
  position: absolute;
  font-family: ui-monospace, "SF Mono", Menlo, monospace;
  font-size: 11.5px;
  padding: 5px 12px;
  border-radius: 999px;
  border: 1px solid var(--lp-line);
  background: oklch(98.6% 0.008 95 / 0.9);
  backdrop-filter: blur(6px);
  color: var(--lp-text-dim);
  box-shadow: 0 4px 14px -6px oklch(28% 0.02 75 / 0.2);
  animation: chipFloat 7s ease-in-out infinite alternate;
}
.chip-a { top: 16%; left: 6%; color: var(--lp-gold-deep); border-color: oklch(52% 0.12 76 / 0.35); }
.chip-b { bottom: 20%; right: 4%; color: var(--lp-gold-deep); border-color: oklch(52% 0.12 76 / 0.35); animation-delay: -3s; }
.chip-c { top: 52%; right: 12%; animation-delay: -5s; }

/* ============ 通用 Section ============ */
.section {
  max-width: 1152px;
  margin: 0 auto;
  padding: 88px 24px 0;
}
.section-head { text-align: center; margin-bottom: 44px; }
.kicker {
  font-family: ui-monospace, "SF Mono", Menlo, monospace;
  font-size: 12px;
  letter-spacing: 0.22em;
  color: var(--lp-gold-deep);
}
.section-head h2 {
  margin: 12px 0 0;
  font-size: clamp(26px, 3.4vw, 38px);
  font-weight: 800;
  letter-spacing: -0.01em;
  color: var(--lp-ink);
  border: none;
}
.section-sub { margin-top: 12px; color: var(--lp-text-dim); font-size: 15px; }

/* ============ 终端窗口（墨黑对比块，编辑页面中的「图版」） ============ */
.terminal {
  max-width: 720px;
  margin: 0 auto;
  border-radius: 16px;
  border: 1px solid oklch(20% 0.015 75);
  background: oklch(20% 0.018 75);
  box-shadow:
    0 1px 0 oklch(98.6% 0.008 95 / 0.06) inset,
    0 32px 72px -28px oklch(24% 0.02 75 / 0.45);
  overflow: hidden;
}
.terminal-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  border-bottom: 1px solid oklch(90% 0.01 90 / 0.08);
  background: oklch(24% 0.02 75);
}
.t-dot { width: 11px; height: 11px; border-radius: 50%; }
.t-r { background: #ff5f57; } .t-y { background: #febc2e; } .t-g { background: #28c840; }
.terminal-title {
  margin-left: 10px;
  font-family: ui-monospace, "SF Mono", Menlo, monospace;
  font-size: 12px;
  color: oklch(90% 0.01 90 / 0.5);
}
.terminal-body {
  padding: 20px 22px 24px;
  font-family: ui-monospace, "SF Mono", Menlo, monospace;
  font-size: 13.5px;
  line-height: 2.05;
  color: oklch(92% 0.015 90);
}
.terminal-body p { margin: 0; }
.t-prompt { color: var(--lp-gold); font-weight: 700; }
.t-cmd { color: oklch(80% 0.13 88); }
.t-out { color: oklch(92% 0.015 90 / 0.55); }
.t-link { color: oklch(80% 0.13 88); text-decoration: underline; }
.cursor {
  display: inline-block;
  width: 8px; height: 16px;
  margin-left: 6px;
  vertical-align: -2px;
  background: var(--lp-gold);
  animation: blink 1.1s steps(2) infinite;
}

/* ============ 架构分层 ============ */
.layers {
  position: relative;
  max-width: 880px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.layers::before {
  content: "";
  position: absolute;
  left: 37px; top: 20px; bottom: 20px;
  width: 2px;
  background: linear-gradient(180deg, var(--lp-gold), oklch(58% 0.1 60), var(--lp-gold-deep));
  opacity: 0.45;
  border-radius: 2px;
}
.layer {
  position: relative;
  display: grid;
  grid-template-columns: 76px 1.1fr 1fr;
  gap: 18px;
  align-items: center;
  padding: 18px 22px 18px 0;
  border-radius: 14px;
  border: 1px solid transparent;
  transition: border-color 0.25s, background 0.25s, transform 0.25s;
}
.layer:hover {
  border-color: oklch(68% 0.15 85 / 0.45);
  background: var(--lp-paper);
  transform: translateX(6px);
}
.layer-id {
  justify-self: center;
  width: 40px; height: 40px;
  display: grid;
  place-items: center;
  border-radius: 12px;
  font-family: ui-monospace, "SF Mono", Menlo, monospace;
  font-size: 13px;
  font-weight: 700;
  color: #fff;
  background: linear-gradient(135deg, oklch(68% 0.14 85), oklch(54% 0.12 74));
  box-shadow: 0 6px 16px -4px oklch(60% 0.13 80 / 0.5);
  position: relative;
  z-index: 1;
}
.layer-name { font-weight: 700; font-size: 15.5px; color: var(--lp-ink); }
.layer-tech {
  font-family: ui-monospace, "SF Mono", Menlo, monospace;
  font-size: 12px;
  color: var(--lp-gold-deep);
  margin-top: 3px;
}
.layer-desc { font-size: 13.5px; line-height: 1.65; color: var(--lp-text-dim); }

/* ============ 特性卡（纸面卡片 + 墨色细边） ============ */
.cards {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 18px;
}
.card {
  position: relative;
  padding: 26px 24px;
  border-radius: 16px;
  border: 1px solid var(--lp-line);
  background: var(--lp-paper);
  overflow: hidden;
  transition: transform 0.25s, border-color 0.25s, box-shadow 0.25s;
}
.card::before {
  content: "";
  position: absolute;
  inset: 0 0 auto;
  height: 3px;
  background: linear-gradient(90deg, var(--lp-gold), oklch(76% 0.13 80));
  opacity: 0;
  transition: opacity 0.25s;
}
.card:hover {
  transform: translateY(-5px);
  border-color: oklch(68% 0.15 85 / 0.5);
  box-shadow: 0 18px 40px -18px oklch(40% 0.06 80 / 0.3);
}
.card:hover::before { opacity: 1; }
.card-icon {
  width: 44px; height: 44px;
  display: grid;
  place-items: center;
  font-size: 21px;
  border-radius: 12px;
  border: 1px solid var(--lp-line);
  background: var(--lp-gold-soft);
}
.card h3 { margin: 16px 0 8px; font-size: 16.5px; font-weight: 700; color: var(--lp-ink); border: none; }
.card p { margin: 0; font-size: 13.5px; line-height: 1.7; color: var(--lp-text-dim); }

/* ============ Provider Pills ============ */
.pills {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 10px;
  max-width: 880px;
  margin: 0 auto;
}
.pill {
  padding: 8px 18px;
  border-radius: 999px;
  font-size: 13.5px;
  border: 1px solid var(--lp-line);
  background: var(--lp-paper);
  color: var(--lp-text-dim);
  transition: border-color 0.2s, color 0.2s, transform 0.2s;
}
.pill:hover {
  border-color: oklch(52% 0.12 76 / 0.5);
  color: var(--lp-gold-deep);
  transform: translateY(-2px);
}
.pill-more {
  border-style: dashed;
  color: var(--lp-gold-deep);
  border-color: oklch(52% 0.12 76 / 0.4);
}

/* ============ 收尾 CTA ============ */
.final {
  position: relative;
  margin-top: 96px;
  padding: 110px 24px 130px;
  text-align: center;
  overflow: hidden;
  border-top: 1px solid var(--lp-line);
}
.final-glow {
  position: absolute;
  left: 50%; top: -30%;
  width: 720px; height: 720px;
  transform: translateX(-50%);
  background: radial-gradient(circle, oklch(84% 0.11 88 / 0.55), transparent 65%);
  filter: blur(60px);
  pointer-events: none;
}
.final h2 {
  position: relative;
  margin: 0 0 36px;
  font-size: clamp(28px, 4vw, 44px);
  font-weight: 800;
  line-height: 1.25;
  color: var(--lp-ink);
  border: none;
}
.final .hero-actions { justify-content: center; margin-top: 0; position: relative; }

/* ============ 动效 ============ */
@keyframes orbFloat {
  from { transform: translate(0, 0) scale(1); }
  to { transform: translate(30px, -24px) scale(1.08); }
}
@keyframes spin { to { transform: rotate(360deg); } }
@keyframes pulse {
  0%, 100% { opacity: 0.5; }
  50% { opacity: 1; }
}
@keyframes leafFloat {
  from { transform: translateY(10px) rotate(-2deg); }
  to { transform: translateY(-12px) rotate(2.5deg); }
}
@keyframes chipFloat {
  from { transform: translateY(6px); }
  to { transform: translateY(-8px); }
}
@keyframes blink { 50% { opacity: 0; } }

@media (prefers-reduced-motion: reduce) {
  .orb, .ring, .leaf-glow, .leaf, .orbit-chip, .pulse-dot, .cursor { animation: none; }
}

/* ============ 响应式 ============ */
@media (max-width: 960px) {
  .hero-inner { grid-template-columns: 1fr; text-align: center; }
  .hero-visual { height: 320px; order: -1; }
  .leaf { width: 150px; }
  .hero-actions, .hero-stats { justify-content: center; }
  .hero-eyebrow { margin: 0 auto; }
  .cards { grid-template-columns: repeat(2, 1fr); }
  .layer { grid-template-columns: 60px 1fr; }
  .layer-desc { grid-column: 2; }
}
@media (max-width: 640px) {
  .hero { padding: 72px 20px 88px; }
  .cards { grid-template-columns: 1fr; }
  .hero-stats { gap: 22px; flex-wrap: wrap; }
  .section { padding-top: 64px; }
}
</style>

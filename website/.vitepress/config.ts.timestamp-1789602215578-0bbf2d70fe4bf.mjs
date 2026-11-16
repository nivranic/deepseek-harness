// website/.vitepress/config.ts
import { readFileSync as readFileSync2, writeFileSync as writeFileSync2 } from "node:fs";
import { resolve as resolve2 } from "node:path";
import { withMermaid } from "file:///E:/Mix/project/deepseek-harness/.worktrees/upstream-first/node_modules/.pnpm/vitepress-plugin-mermaid@2._4e5e1d2dbd0e712c5a716bdb24f56ddf/node_modules/vitepress-plugin-mermaid/dist/vitepress-plugin-mermaid.es.mjs";

// website/docs.ts
function localized(value, locale) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value[locale] : value;
}
function mirroredPages(pages) {
  return pages.flatMap((page) => ["root", "en"].map((locale) => {
    const aliases = page.sourceAliases === void 0 ? void 0 : Array.isArray(page.sourceAliases) ? page.sourceAliases : page.sourceAliases[locale];
    return {
      locale,
      contentLocale: localized(page.contentLocale, locale),
      source: localized(page.source, locale),
      route: locale === "root" ? page.route : `en/${page.route}`,
      label: page.label[locale],
      sidebar: page.sidebar[locale],
      section: page.section[locale],
      order: page.order,
      ...page.outline === void 0 ? {} : { outline: page.outline },
      ...aliases === void 0 ? {} : { sourceAliases: aliases }
    };
  }));
}
function pairedPages(pages) {
  return mirroredPages(pages.map((page) => {
    const chineseSource = page.source.replace(/\.md$/, ".zh.md");
    const sharedAliases = page.sourceAliases ?? [];
    return {
      ...page,
      source: { root: chineseSource, en: page.source },
      contentLocale: { root: "zh-CN", en: "en-US" },
      sourceAliases: {
        root: [...sharedAliases, page.source],
        en: [...sharedAliases, chineseSource]
      }
    };
  }));
}
var homeAndGuide = pairedPages([
  {
    source: "docs/user/index.md",
    route: "index.md",
    label: { root: "DeepSeek Harness", en: "DeepSeek Harness" },
    sidebar: { root: null, en: null },
    section: { root: "\u9996\u9875", en: "Home" },
    order: 0
  },
  {
    source: "docs/user/guide/index.md",
    route: "guide/quickstart.md",
    label: { root: "\u4F7F\u7528 Web UI", en: "Use the Web UI" },
    sidebar: { root: "zh-guide", en: "en-guide" },
    section: { root: "\u5165\u95E8", en: "Guide" },
    order: 1,
    sourceAliases: ["docs/user/guide"]
  },
  {
    source: "docs/user/guide/providers.md",
    route: "guide/providers.md",
    label: { root: "\u914D\u7F6E\u6A21\u578B", en: "Configure models" },
    sidebar: { root: "zh-guide", en: "en-guide" },
    section: { root: "\u5165\u95E8", en: "Guide" },
    order: 2
  },
  {
    source: "docs/user/guide/network-proxy.md",
    route: "guide/network-proxy.md",
    label: { root: "\u7F51\u7EDC\u4EE3\u7406", en: "Network proxy" },
    sidebar: { root: "zh-guide", en: "en-guide" },
    section: { root: "\u5165\u95E8", en: "Guide" },
    order: 3
  },
  {
    source: "docs/user/guide/python-sdk.md",
    route: "guide/python-sdk.md",
    label: { root: "Python", en: "Python" },
    sidebar: { root: "zh-guide", en: "en-guide" },
    section: { root: "SDK", en: "SDK" },
    order: 1
  },
  {
    source: "docs/user/guide/github-review.md",
    route: "guide/github-review.md",
    label: { root: "GitHub \u8BC4\u5BA1\u4F1A\u8BDD", en: "GitHub review sessions" },
    sidebar: { root: "zh-guide", en: "en-guide" },
    section: { root: "\u81EA\u52A8\u5316", en: "Automation" },
    order: 1
  },
  {
    source: "docs/user/guide/schedule.md",
    route: "guide/schedule.md",
    label: { root: "\u4F1A\u8BDD\u5185\u63D0\u9192", en: "Session reminders" },
    sidebar: { root: "zh-guide", en: "en-guide" },
    section: { root: "\u81EA\u52A8\u5316", en: "Automation" },
    order: 2
  },
  {
    source: "docs/user/guide/mcp-memory.md",
    route: "guide/mcp-memory.md",
    label: { root: "\u8BB0\u5FC6 MCP", en: "Memory MCP" },
    sidebar: { root: "zh-guide", en: "en-guide" },
    section: { root: "\u96C6\u6210", en: "Integrations" },
    order: 1
  }
]);
var develop = pairedPages([
  {
    source: "docs/user/develop/basic/index.md",
    route: "develop/basic/index.md",
    label: { root: "\u7B2C\u4E00\u4E2A Harness \u63D2\u4EF6", en: "Your first Harness plugin" },
    sidebar: { root: "zh-develop", en: "en-develop" },
    section: { root: "\u57FA\u7840", en: "Basics" },
    order: 1,
    sourceAliases: ["docs/user/develop/basic"]
  },
  {
    source: "docs/user/develop/basic/tool.md",
    route: "develop/basic/tool.md",
    label: { root: "\u5F00\u53D1\u4E00\u4E2A Tool", en: "Build a tool" },
    sidebar: { root: "zh-develop", en: "en-develop" },
    section: { root: "\u57FA\u7840", en: "Basics" },
    order: 2
  },
  {
    source: "docs/user/develop/basic/config.md",
    route: "develop/basic/config.md",
    label: { root: "\u63D2\u4EF6\u914D\u7F6E", en: "Plugin configuration" },
    sidebar: { root: "zh-develop", en: "en-develop" },
    section: { root: "\u57FA\u7840", en: "Basics" },
    order: 3
  },
  {
    source: "docs/user/develop/basic/publish.md",
    route: "develop/basic/publish.md",
    label: { root: "\u6253\u5305\u4E0E\u5B89\u88C5\u63D2\u4EF6", en: "Package and install" },
    sidebar: { root: "zh-develop", en: "en-develop" },
    section: { root: "\u57FA\u7840", en: "Basics" },
    order: 4
  },
  {
    source: "docs/user/develop/framework/index.md",
    route: "develop/framework/index.md",
    label: { root: "\u63D2\u4EF6\u4E0E\u751F\u547D\u5468\u671F", en: "Plugin lifecycle" },
    sidebar: { root: "zh-develop", en: "en-develop" },
    section: { root: "\u6846\u67B6\u80FD\u529B", en: "Framework" },
    order: 1,
    sourceAliases: ["docs/user/develop/framework"]
  },
  {
    source: "docs/user/develop/framework/service.md",
    route: "develop/framework/service.md",
    label: { root: "\u670D\u52A1\u4E0E\u4F9D\u8D56", en: "Services and dependencies" },
    sidebar: { root: "zh-develop", en: "en-develop" },
    section: { root: "\u6846\u67B6\u80FD\u529B", en: "Framework" },
    order: 2
  },
  {
    source: "docs/user/develop/framework/events.md",
    route: "develop/framework/events.md",
    label: { root: "\u4E8B\u4EF6\u7CFB\u7EDF", en: "Event system" },
    sidebar: { root: "zh-develop", en: "en-develop" },
    section: { root: "\u6846\u67B6\u80FD\u529B", en: "Framework" },
    order: 3
  },
  {
    source: "docs/user/develop/practice/index.md",
    route: "develop/practice/index.md",
    label: { root: "\u80FD\u529B\u7684\u4E09\u5C42\u62C6\u5206", en: "Capability layering" },
    sidebar: { root: "zh-develop", en: "en-develop" },
    section: { root: "\u5B9E\u6218", en: "Practice" },
    order: 1,
    sourceAliases: ["docs/user/develop/practice"]
  },
  {
    source: "docs/user/develop/practice/llm-adapter.md",
    route: "develop/practice/llm-adapter.md",
    label: { root: "LLM \u9002\u914D\u5668", en: "LLM adapter" },
    sidebar: { root: "zh-develop", en: "en-develop" },
    section: { root: "\u5B9E\u6218", en: "Practice" },
    order: 2
  },
  {
    source: "docs/user/develop/practice/dynamic-cordis.md",
    route: "develop/practice/dynamic-cordis.md",
    label: { root: "\u8FD0\u884C\u65F6 Cordis \u5DE5\u5177", en: "Runtime Cordis tools" },
    sidebar: { root: "zh-develop", en: "en-develop" },
    section: { root: "\u5B9E\u6218", en: "Practice" },
    order: 3
  }
]);
var cordisTutorial = pairedPages([
  ["index.md", "\u603B\u89C8", "Overview"],
  ["01-first-plugin.md", "1. \u7B2C\u4E00\u4E2A\u63D2\u4EF6", "1. Your first plugin"],
  ["02-lifecycle-and-effects.md", "2. \u751F\u547D\u5468\u671F\u4E0E\u526F\u4F5C\u7528", "2. Lifecycle and effects"],
  ["03-services.md", "3. \u670D\u52A1", "3. Services"],
  ["04-events.md", "4. \u4E8B\u4EF6", "4. Events"],
  ["05-config.md", "5. \u914D\u7F6E", "5. Configuration"],
  ["06-composition-and-hmr.md", "6. \u7EC4\u5408\u4E0E\u70ED\u91CD\u8F7D", "6. Composition and HMR"],
  ["07-into-the-harness.md", "7. \u8FDB\u5165 Harness", "7. Into the harness"]
].map(([file, rootLabel, enLabel], order) => ({
  source: `docs/cordis-tutorial/${file}`,
  route: `develop/cordis-tutorial/${file}`,
  label: { root: rootLabel, en: enLabel },
  sidebar: { root: "zh-develop", en: "en-develop" },
  section: { root: "Cordis \u6846\u67B6\u6559\u7A0B", en: "Cordis framework tutorial" },
  order,
  ...file === "index.md" ? { sourceAliases: ["docs/cordis-tutorial"] } : {}
})));
var cordisPrimerReference = pairedPages([
  {
    source: "docs/cordis-primer.md",
    route: "reference/cordis-primer.md",
    label: { root: "Cordis \u5165\u95E8", en: "Cordis primer" },
    sidebar: { root: "zh-reference", en: "en-reference" },
    section: { root: "\u6982\u5FF5", en: "Concepts" },
    order: 1
  }
]);
var subsystemGroups = [
  ["\u603B\u89C8", "Overview", [
    ["README.md", "\u5B50\u7CFB\u7EDF", "Subsystems"]
  ]],
  ["\u5185\u6838\u4E0E\u4F5C\u7528\u57DF", "Core and scopes", [
    ["core.md", "\u6838\u5FC3", "Core"],
    ["scope.md", "\u4F5C\u7528\u57DF", "Scopes"],
    ["invariants.md", "\u8FD0\u884C\u65F6\u4E0D\u53D8\u5F0F", "Runtime invariants"]
  ]],
  ["\u4F1A\u8BDD\u4E0E\u6301\u4E45\u5316", "Sessions and persistence", [
    ["session.md", "\u4F1A\u8BDD", "Sessions"],
    ["session-query.md", "\u4F1A\u8BDD\u67E5\u8BE2", "Session query"],
    ["session-reference.md", "\u4F1A\u8BDD\u5F15\u7528", "Session references"],
    ["session-title.md", "\u4F1A\u8BDD\u6807\u9898", "Session titles"],
    ["session-projection.md", "\u4F1A\u8BDD\u6295\u5F71", "Session projections"],
    ["persistence.md", "\u4F1A\u8BDD\u6301\u4E45\u5316", "Session persistence"],
    ["spill.md", "Spill \u5B58\u50A8", "Spill storage"],
    ["session-telemetry.md", "\u9065\u6D4B", "SessionTelemetryBackend"]
  ]],
  ["\u6A21\u578B\u4E0E\u4E0A\u4E0B\u6587", "Model and context", [
    ["llm-streaming.md", "LLM \u6D41\u5F0F\u54CD\u5E94", "LLM streaming"],
    ["token-meter.md", "Token \u8BA1\u91CF", "Token metering"],
    ["system-prompt.md", "\u7CFB\u7EDF\u63D0\u793A\u8BCD", "System prompts"],
    ["compaction.md", "\u4E0A\u4E0B\u6587\u538B\u7F29", "Compaction"]
  ]],
  ["\u6267\u884C\u4E0E\u5DE5\u5177", "Execution and tools", [
    ["tools.md", "\u5DE5\u5177", "Tools"],
    ["shell.md", "Bash \u6267\u884C", "Bash execution"],
    ["subprocess.md", "\u5B50\u8FDB\u7A0B", "Subprocesses"],
    ["terminal.md", "PTY \u4F1A\u8BDD", "PTY sessions"],
    ["jobs.md", "\u540E\u53F0\u4EFB\u52A1", "Background jobs"],
    ["filesystem.md", "\u6587\u4EF6\u7CFB\u7EDF", "Filesystem"],
    ["lsp.md", "LSP \u5BFC\u822A", "LSP navigation"],
    ["code-runtime.md", "\u4EE3\u7801\u8FD0\u884C\u65F6", "Code runtime"],
    ["web.md", "Web \u8BBF\u95EE", "Web access"],
    ["skills.md", "\u6280\u80FD", "Skills"],
    ["workflow.md", "\u5DE5\u4F5C\u6D41", "Workflows"],
    ["subagent.md", "\u5B50\u4EE3\u7406", "Subagents"]
  ]],
  ["\u7B56\u7565\u4E0E\u4EA4\u4E92", "Policy and interaction", [
    ["approval.md", "\u5BA1\u6279", "Approvals"],
    ["permission-presets.md", "\u6743\u9650\u9884\u8BBE", "Permission presets"],
    ["sandbox.md", "\u6C99\u7BB1", "Sandboxing"],
    ["plan.md", "\u8BA1\u5212\u6A21\u5F0F", "Plan mode"],
    ["user-questions.md", "\u7528\u6237\u4EA4\u4E92", "User interaction"],
    ["commands.md", "\u547D\u4EE4", "Human commands"],
    ["goal.md", "\u76EE\u6807", "Goals"],
    ["schedule.md", "\u5B9A\u65F6\u63D0\u9192", "Scheduled reminders"]
  ]],
  ["\u5E73\u53F0\u4E0E\u63A5\u5165", "Platform and access", [
    ["web-server.md", "HTTP \u670D\u52A1\u5668", "HTTP server"],
    ["web-client.md", "Web Client \u67B6\u6784", "Web Client architecture"],
    ["client-modules.md", "\u5BA2\u6237\u7AEF\u6A21\u5757", "Client modules"],
    ["slots.md", "\u5BA2\u6237\u7AEF Slots", "Client slots"],
    ["client-resources.md", "\u5BA2\u6237\u7AEF\u8D44\u6E90", "Client resources"],
    ["sidebar-right.md", "\u53F3\u4FA7 Sidebar", "Right Sidebar"],
    ["conversation.md", "Conversation \u7EC4\u88C5", "Conversation assembly"],
    ["typert.md", "Typert", "Typert"],
    ["storage.md", "\u5B58\u50A8", "Storage"],
    ["workspace.md", "\u5DE5\u4F5C\u533A", "Workspaces"],
    ["settings.md", "\u7528\u6237\u8BBE\u7F6E", "User settings"],
    ["credentials.md", "\u7528\u6237\u51ED\u636E", "User credentials"]
  ]]
];
var subsystemsReference = subsystemGroups.flatMap(([rootSection, enSection, files]) => pairedPages(
  files.map(([file, rootLabel, enLabel], order) => ({
    source: `docs/subsystems/${file}`,
    route: file === "README.md" ? "reference/subsystems/index.md" : `reference/subsystems/${file}`,
    label: { root: rootLabel, en: enLabel },
    sidebar: { root: "zh-reference", en: "en-reference" },
    section: { root: rootSection, en: enSection },
    order,
    // Subsystem pages carry long third-level sections a two-level outline reaches.
    outline: [2, 3],
    ...file === "README.md" ? { sourceAliases: ["docs/subsystems"] } : {}
  }))
));
var reference = [
  // `docs/deepseek-llm-api-wire-extensions.md` is a repository-only provider protocol reference.
  // Projected links intentionally resolve to its GitHub source instead of a public site route.
  ...pairedPages([
    ["docs/architecture.md", "reference/index.md", "\u67B6\u6784", "Architecture", 0]
  ].map(([source, route, rootLabel, enLabel, order]) => ({
    source,
    route,
    label: { root: rootLabel, en: enLabel },
    sidebar: { root: "zh-reference", en: "en-reference" },
    section: { root: "\u6982\u5FF5", en: "Concepts" },
    order
  }))),
  ...pairedPages([
    ["docs/capability-seams.md", "reference/capability-seams.md", "\u80FD\u529B\u670D\u52A1", "Capability services", 2],
    ["docs/agent-lifecycle.md", "reference/agent-lifecycle.md", "Agent \u751F\u547D\u5468\u671F", "Agent lifecycle", 3],
    ["docs/tool-execution-pipeline.md", "reference/tool-execution-pipeline.md", "Tool \u6267\u884C", "Tool execution", 4],
    ["docs/api-gateway.md", "reference/api-gateway.md", "API Gateway", "API Gateway", 5]
  ].map(([source, route, rootLabel, enLabel, order]) => ({
    source,
    route,
    label: { root: rootLabel, en: enLabel },
    sidebar: { root: "zh-reference", en: "en-reference" },
    section: { root: "\u6982\u5FF5", en: "Concepts" },
    order
  }))),
  ...pairedPages([
    ["docs/config-catalog.md", "reference/config-catalog.md", "\u63D2\u4EF6\u914D\u7F6E", "Plugin configuration"],
    ["docs/tool-catalog.md", "reference/tool-catalog.md", "Tool Schema", "Tool schemas"],
    ["docs/persistence-catalog.md", "reference/persistence-catalog.md", "\u6301\u4E45\u5316\u4E8B\u4EF6", "Persistence events", "deep"]
  ].map(([source, route, rootLabel, enLabel, outline], order) => ({
    source,
    route,
    label: { root: rootLabel, en: enLabel },
    sidebar: { root: "zh-reference", en: "en-reference" },
    section: { root: "\u751F\u6210\u53C2\u8003", en: "Generated reference" },
    order,
    ...outline === void 0 ? {} : { outline }
  }))),
  ...pairedPages([
    ["context.md", "Context", "Context"],
    ["events.md", "Events", "Events"],
    ["fiber.md", "Fiber", "Fiber"],
    ["registry.md", "Plugin Registry", "Plugin Registry"],
    ["service.md", "Service", "Service"]
  ].map(([file, rootLabel, enLabel], order) => ({
    source: `docs/cordis-api/${file}`,
    route: `reference/cordis-api/${file}`,
    label: { root: rootLabel, en: enLabel },
    sidebar: { root: "zh-reference", en: "en-reference" },
    section: { root: "Cordis API", en: "Cordis Core API" },
    order
  }))),
  ...mirroredPages([
    ["inherited.md", "\u7EE7\u627F\u63A5\u53E3\u9762", "Inherited surface"]
  ].map(([file, rootLabel, enLabel], order) => ({
    source: `docs/cordis-api/${file}`,
    route: `reference/cordis-api/${file}`,
    contentLocale: "en-US",
    label: { root: rootLabel, en: enLabel },
    sidebar: { root: "zh-reference", en: "en-reference" },
    section: { root: "Cordis API", en: "Cordis Core API" },
    order: order + 5
  }))),
  ...pairedPages([
    ["adding-a-package.md", "\u65B0\u589E Package", "Adding a package"],
    ["adding-a-tool.md", "\u65B0\u589E Tool", "Adding a tool"],
    ["adding-an-llm-adapter.md", "\u65B0\u589E LLM Adapter", "Adding an LLM adapter"],
    ["adding-a-settings-card.md", "\u65B0\u589E\u8BBE\u7F6E\u5361\u7247", "Adding a settings card"],
    ["extension-cookbook.md", "\u6269\u5C55\u6A21\u5F0F", "Extension patterns"]
  ].map(([file, rootLabel, enLabel], order) => ({
    source: `docs/cookbook/${file}`,
    route: `reference/cookbook/${file}`,
    label: { root: rootLabel, en: enLabel },
    sidebar: { root: "zh-reference", en: "en-reference" },
    section: { root: "\u5F00\u53D1\u624B\u518C", en: "Cookbook" },
    order
  })))
];
var localeCollections = {
  root: ["zh-guide", "zh-develop", "zh-reference"],
  en: ["en-guide", "en-develop", "en-reference"]
};
var sections = {
  root: [
    { label: "\u5165\u95E8" },
    { label: "SDK" },
    { label: "\u81EA\u52A8\u5316" },
    { label: "\u96C6\u6210" },
    { label: "\u57FA\u7840" },
    { label: "\u6846\u67B6\u80FD\u529B" },
    { label: "\u5B9E\u6218" },
    { label: "Cordis \u6846\u67B6\u6559\u7A0B" },
    { label: "\u6982\u5FF5" },
    { label: "\u751F\u6210\u53C2\u8003" },
    { label: "Cordis API" },
    { label: "\u5F00\u53D1\u624B\u518C" },
    { label: "\u603B\u89C8" },
    { label: "\u5185\u6838\u4E0E\u4F5C\u7528\u57DF", collapsed: true },
    { label: "\u4F1A\u8BDD\u4E0E\u6301\u4E45\u5316", collapsed: true },
    { label: "\u6A21\u578B\u4E0E\u4E0A\u4E0B\u6587", collapsed: true },
    { label: "\u6267\u884C\u4E0E\u5DE5\u5177", collapsed: true },
    { label: "\u7B56\u7565\u4E0E\u4EA4\u4E92", collapsed: true },
    { label: "\u5E73\u53F0\u4E0E\u63A5\u5165", collapsed: true }
  ],
  en: [
    { label: "Guide" },
    { label: "SDK" },
    { label: "Automation" },
    { label: "Integrations" },
    { label: "Basics" },
    { label: "Framework" },
    { label: "Practice" },
    { label: "Cordis framework tutorial" },
    { label: "Concepts" },
    { label: "Generated reference" },
    { label: "Cordis Core API" },
    { label: "Cookbook" },
    { label: "Overview" },
    { label: "Core and scopes", collapsed: true },
    { label: "Sessions and persistence", collapsed: true },
    { label: "Model and context", collapsed: true },
    { label: "Execution and tools", collapsed: true },
    { label: "Policy and interaction", collapsed: true },
    { label: "Platform and access", collapsed: true }
  ]
};
function sectionSpec(locale, label) {
  const declared = sections[locale];
  const section = declared.find((candidate) => candidate.label === label);
  if (section === void 0) throw new Error(`Sidebar section "${label}" has no placement in the ${locale} locale.`);
  return { ...section, index: declared.indexOf(section) };
}
var docsPages = [
  ...homeAndGuide,
  ...develop,
  ...cordisTutorial,
  ...cordisPrimerReference,
  ...subsystemsReference,
  ...reference
];
function orderedPages(locale, collection) {
  return docsPages.filter((page) => page.locale === locale && page.sidebar === collection).sort((left, right) => sectionSpec(locale, left.section).index - sectionSpec(locale, right.section).index || left.order - right.order);
}
function routeLink(route) {
  return `/${route.replace(/(?:index)?\.md$/, "")}`;
}
function landingLink(locale, collection) {
  const first = orderedPages(locale, collection)[0];
  if (first === void 0) throw new Error(`Sidebar collection "${collection}" publishes no page.`);
  return routeLink(first.route);
}

// scripts/project-doc-site.ts
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { basename, dirname, extname, posix, relative, resolve, sep } from "node:path";
import { fromMarkdown as fromMarkdown2 } from "file:///E:/Mix/project/deepseek-harness/.worktrees/upstream-first/node_modules/.pnpm/mdast-util-from-markdown@2.0.3_supports-color@9.4.0/node_modules/mdast-util-from-markdown/index.js";
import { gfmFromMarkdown as gfmFromMarkdown2 } from "file:///E:/Mix/project/deepseek-harness/.worktrees/upstream-first/node_modules/.pnpm/mdast-util-gfm@3.1.0/node_modules/mdast-util-gfm/index.js";
import { gfm as gfm2 } from "file:///E:/Mix/project/deepseek-harness/.worktrees/upstream-first/node_modules/.pnpm/micromark-extension-gfm@3.0.0/node_modules/micromark-extension-gfm/index.js";

// scripts/markdown.ts
import { fromMarkdown } from "file:///E:/Mix/project/deepseek-harness/.worktrees/upstream-first/node_modules/.pnpm/mdast-util-from-markdown@2.0.3_supports-color@9.4.0/node_modules/mdast-util-from-markdown/index.js";
import { gfmFromMarkdown } from "file:///E:/Mix/project/deepseek-harness/.worktrees/upstream-first/node_modules/.pnpm/mdast-util-gfm@3.1.0/node_modules/mdast-util-gfm/index.js";
import { gfm } from "file:///E:/Mix/project/deepseek-harness/.worktrees/upstream-first/node_modules/.pnpm/micromark-extension-gfm@3.0.0/node_modules/micromark-extension-gfm/index.js";
function isExternalOrAbsoluteMarkdownUrl(url) {
  return url.startsWith("#") || url.startsWith("//") || url.startsWith("/") || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url);
}
function splitMarkdownUrlTarget(url) {
  const boundary = url.search(/[?#]/);
  if (boundary === -1) return { path: url, suffix: "" };
  return { path: url.slice(0, boundary), suffix: url.slice(boundary) };
}
function skipWhitespace(source, start) {
  let index = start;
  while (/\s/.test(source[index] ?? "")) index += 1;
  return index;
}
function labelEnd(source) {
  const first = source.indexOf("[");
  if (first === -1) return -1;
  let depth = 0;
  for (let index = first; index < source.length; index += 1) {
    const char = source[index];
    if (char === "\\") index += 1;
    else if (char === "[") depth += 1;
    else if (char === "]") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}
function destinationRange(rawNode, type) {
  const endOfLabel = labelEnd(rawNode);
  if (endOfLabel === -1) throw new Error(`markdown: cannot locate label end in ${JSON.stringify(rawNode)}`);
  let start;
  if (type === "definition") {
    const colon = rawNode.indexOf(":", endOfLabel + 1);
    if (colon === -1) throw new Error(`markdown: cannot locate definition separator in ${JSON.stringify(rawNode)}`);
    start = skipWhitespace(rawNode, colon + 1);
  } else {
    if (rawNode[endOfLabel + 1] !== "(") {
      throw new Error(`markdown: cannot locate inline destination in ${JSON.stringify(rawNode)}`);
    }
    start = skipWhitespace(rawNode, endOfLabel + 2);
  }
  if (rawNode[start] === "<") {
    for (let index = start + 1; index < rawNode.length; index += 1) {
      if (rawNode[index] === "\\") index += 1;
      else if (rawNode[index] === ">") return { start: start + 1, end: index };
    }
    throw new Error(`markdown: cannot locate angle-bracket destination end in ${JSON.stringify(rawNode)}`);
  }
  let depth = 0;
  for (let index = start; index < rawNode.length; index += 1) {
    const char = rawNode[index];
    if (char === "\\") index += 1;
    else if (char === "(") depth += 1;
    else if (char === ")") {
      if (depth === 0) return { start, end: index };
      depth -= 1;
    } else if (/\s/.test(char ?? "") && depth === 0) {
      return { start, end: index };
    }
  }
  return { start, end: rawNode.length };
}
function markdownDestination(source, node) {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  if (start === void 0 || end === void 0) {
    throw new Error(`markdown: destination ${JSON.stringify(node.url)} has no source offsets`);
  }
  const range = destinationRange(source.slice(start, end), node.type);
  const absolute = { start: start + range.start, end: start + range.end };
  return { ...absolute, url: source.slice(absolute.start, absolute.end) };
}

// scripts/project-doc-site.ts
var __vite_injected_original_dirname = "E:\\Mix\\project\\deepseek-harness\\.worktrees\\upstream-first\\scripts";
var REPOSITORY_URL = "https://github.com/deepseek-ai/deepseek-harness";
var root = resolve(__vite_injected_original_dirname, "..");
var generatedRoot = resolve(root, "website/.generated");
function resolveRepositoryRef(environment) {
  return environment.DOCS_REPOSITORY_REF ?? "master";
}
function repoPath(absPath, repoRoot) {
  return relative(repoRoot, absPath).split(sep).join("/");
}
function decodePath(path) {
  try {
    return decodeURIComponent(path);
  } catch {
    throw new Error(`project-doc-site: malformed percent escape in ${JSON.stringify(path)}.`);
  }
}
function routeTarget(fromRoute, toRoute, suffix) {
  const target = posix.relative(posix.dirname(fromRoute), toRoute);
  return `${target.startsWith(".") ? target : `./${target}`}${suffix}`;
}
function sourceMap(pages) {
  const map = /* @__PURE__ */ new Map();
  for (const page of pages) {
    for (const source of [page.source, ...page.sourceAliases ?? []]) {
      const localized2 = map.get(source) ?? /* @__PURE__ */ new Map();
      if (localized2.has(page.locale)) {
        throw new Error(`project-doc-site: duplicate source or alias ${JSON.stringify(source)} for locale ${JSON.stringify(page.locale)}.`);
      }
      localized2.set(page.locale, page);
      map.set(source, localized2);
    }
  }
  return map;
}
function counterpartSource(source) {
  return source.endsWith(".zh.md") ? source.replace(/\.zh\.md$/, ".md") : source.replace(/\.md$/, ".zh.md");
}
function resolveRepositoryTarget(sourceAbs, rawPath, repoRoot) {
  const decoded = decodePath(rawPath);
  let absPath = resolve(dirname(sourceAbs), decoded);
  if (existsSync(absPath)) return { absPath };
  const lineMatch = decoded.match(/:(\d+)$/);
  if (lineMatch !== null) {
    const lineText = lineMatch[1];
    if (lineText === void 0) throw new Error("project-doc-site: line suffix matched without a line number.");
    absPath = resolve(dirname(sourceAbs), decoded.slice(0, -lineMatch[0].length));
    if (existsSync(absPath)) return { absPath, line: Number.parseInt(lineText, 10) };
  }
  if (extname(decoded) === "") {
    const markdown = resolve(dirname(sourceAbs), `${decoded}.md`);
    if (existsSync(markdown)) return { absPath: markdown };
    const index = resolve(dirname(sourceAbs), decoded, "index.md");
    if (existsSync(index)) return { absPath: index };
  }
  throw new Error(`project-doc-site: ${repoPath(sourceAbs, repoRoot)} links to missing path ${JSON.stringify(rawPath)}.`);
}
function githubTarget(absPath, line, suffix, repositoryRef, repoRoot, image) {
  const path = repoPath(absPath, repoRoot);
  if (image) return `https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/${repositoryRef}/${path}${suffix}`;
  const kind = lstatSync(absPath).isDirectory() ? "tree" : "blob";
  const lineSuffix = line === void 0 ? suffix : `#L${line}`;
  return `${REPOSITORY_URL}/${kind}/${repositoryRef}/${path}${lineSuffix}`;
}
function rewriteMarkdown(source, options) {
  const sourceAbs = resolve(options.repoRoot, options.sourcePath);
  const published = sourceMap(options.pages);
  const tree = fromMarkdown2(source, { extensions: [gfm2()], mdastExtensions: [gfmFromMarkdown2()] });
  const replacements = [];
  const rewrite = (node) => {
    if (isExternalOrAbsoluteMarkdownUrl(node.url)) return;
    const { path, suffix } = splitMarkdownUrlTarget(node.url);
    if (path === "") return;
    const { absPath, line } = resolveRepositoryTarget(sourceAbs, path, options.repoRoot);
    const targetPath = repoPath(absPath, options.repoRoot);
    const isLanguageSwitcher = targetPath === counterpartSource(options.sourcePath);
    const targetLocale = isLanguageSwitcher ? options.locale === "root" ? "en" : "root" : options.locale;
    const page = published.get(targetPath)?.get(targetLocale);
    const nextUrl = page !== void 0 ? routeTarget(options.route, page.route, suffix) : node.type === "image" && options.placeImage !== void 0 ? `${options.placeImage(absPath)}${suffix}` : githubTarget(absPath, line, suffix, options.repositoryRef, options.repoRoot, node.type === "image");
    const destination = markdownDestination(source, node);
    replacements.push({
      start: destination.start,
      end: destination.end,
      value: nextUrl
    });
  };
  const visit = (node) => {
    if ((node.type === "link" || node.type === "image" || node.type === "definition") && "url" in node) rewrite(node);
    if ("children" in node) {
      for (const child of node.children) visit(child);
    }
  };
  visit(tree);
  let projected = source;
  for (const replacement of replacements.sort((a, b) => b.start - a.start)) {
    projected = projected.slice(0, replacement.start) + replacement.value + projected.slice(replacement.end);
  }
  return projected;
}
function addProjectionFrontmatter(markdown, page) {
  const fields = [
    `editSource: ${JSON.stringify(page.source)}`,
    ...page.outline === void 0 ? [] : [`outline: ${JSON.stringify(page.outline)}`]
  ].join("\n");
  if (markdown.startsWith("---\n")) return markdown.replace("---\n", `---
${fields}
`);
  return `---
${fields}
---

${markdown}`;
}
var LANGUAGE_SWITCHER = /^(?:English \| \[中文\]\([^)]*\)|\[English\]\([^)]*\) \| 中文)$/;
var REPOSITORY_BADGE = /^\[!\[[^\]]*\]\(https:\/\/img\.shields\.io\/[^)]*\)\]\([^)]*\)$/;
function withoutRepositoryChrome(markdown) {
  const lines = markdown.split("\n");
  const switcher = lines.findIndex((line) => LANGUAGE_SWITCHER.test(line));
  if (switcher !== -1 && switcher < 8) {
    lines.splice(switcher, lines[switcher + 1] === "" ? 2 : 1);
  }
  const badge = lines.findLastIndex((line) => REPOSITORY_BADGE.test(line));
  if (badge !== -1) {
    lines.splice(lines[badge - 1] === "" ? badge - 1 : badge, lines[badge - 1] === "" ? 2 : 1);
  }
  return lines.join("\n");
}
function projectedPageContent(markdown, page) {
  if (page.sidebar !== null) return withoutRepositoryChrome(markdown);
  if (!markdown.startsWith("---\n")) {
    throw new Error(`project-doc-site: locale home source ${JSON.stringify(page.source)} must start with YAML frontmatter.`);
  }
  const closingDelimiter = "\n---\n";
  const closing = markdown.indexOf(closingDelimiter, 4);
  if (closing === -1) {
    throw new Error(`project-doc-site: locale home source ${JSON.stringify(page.source)} has unclosed YAML frontmatter.`);
  }
  return markdown.slice(0, closing + closingDelimiter.length);
}
function publishableImage(absPath, repoRoot) {
  const real = realpathSync(absPath);
  const inside = real === repoRoot || real.startsWith(`${repoRoot}${sep}`);
  return inside && statSync(real).isFile() ? real : void 0;
}
function referencedImages() {
  const found = /* @__PURE__ */ new Set();
  for (const page of docsPages) {
    const sourceAbs = resolve(root, page.source);
    if (!existsSync(sourceAbs)) continue;
    rewriteMarkdown(readFileSync(sourceAbs, "utf8"), {
      sourcePath: page.source,
      locale: page.locale,
      route: page.route,
      pages: docsPages,
      repoRoot: root,
      repositoryRef: "master",
      placeImage: (absPath) => {
        const real = publishableImage(absPath, root);
        if (real !== void 0) found.add(real);
        return "";
      }
    });
  }
  return [...found];
}
function docsSourceFiles() {
  return [.../* @__PURE__ */ new Set([...docsPages.map((page) => resolve(root, page.source)), ...referencedImages()])];
}
function defaultProjectionContext() {
  return { pages: docsPages, repoRoot: root, repositoryRef: resolveRepositoryRef(process.env) };
}
function projectPagesInto(targetRoot, context, pageContent, entries = context.pages) {
  const routes = /* @__PURE__ */ new Set();
  const claimed = /* @__PURE__ */ new Map();
  const claim = (target, sourceAbs) => {
    const holder = claimed.get(target);
    if (holder !== void 0 && holder !== sourceAbs) {
      throw new Error(
        `project-doc-site: ${repoPath(sourceAbs, context.repoRoot)} and ${repoPath(holder, context.repoRoot)} both project to ${relative(targetRoot, target).split(sep).join("/")}.`
      );
    }
    if (holder === void 0 && existsSync(target)) {
      throw new Error(
        `project-doc-site: ${repoPath(sourceAbs, context.repoRoot)} would overwrite existing build file ${relative(targetRoot, target).split(sep).join("/")}.`
      );
    }
    claimed.set(target, sourceAbs);
  };
  for (const page of entries) {
    if (routes.has(page.route)) throw new Error(`project-doc-site: duplicate route ${JSON.stringify(page.route)}.`);
    routes.add(page.route);
    const sourceAbs = resolve(context.repoRoot, page.source);
    if (!existsSync(sourceAbs) || !lstatSync(sourceAbs).isFile()) {
      throw new Error(`project-doc-site: source ${JSON.stringify(page.source)} does not exist or is not a file.`);
    }
    const output = resolve(targetRoot, page.route);
    claim(output, sourceAbs);
    mkdirSync(dirname(output), { recursive: true });
    const markdown = readFileSync(sourceAbs, "utf8");
    const projected = rewriteMarkdown(markdown, {
      sourcePath: page.source,
      locale: page.locale,
      route: page.route,
      pages: context.pages,
      repoRoot: context.repoRoot,
      repositoryRef: context.repositoryRef,
      placeImage: (absPath) => {
        const real = publishableImage(absPath, context.repoRoot);
        if (real === void 0) {
          throw new Error(
            `project-doc-site: ${page.source} references image ${repoPath(absPath, context.repoRoot)}, which is not a regular file inside the repository.`
          );
        }
        const name = basename(real);
        const target = resolve(dirname(output), name);
        claim(target, real);
        copyFileSync(real, target);
        return `./${encodeURI(name)}`;
      }
    });
    writeFileSync(output, pageContent(projected, page));
  }
}
function projectDocs() {
  rmSync(generatedRoot, { recursive: true, force: true });
  projectPagesInto(generatedRoot, defaultProjectionContext(), (markdown, page) => addProjectionFrontmatter(projectedPageContent(markdown, page), page));
}
function withoutFrontmatter(markdown, source) {
  if (!markdown.startsWith("---\n")) return markdown;
  const closingDelimiter = "\n---\n";
  const closing = markdown.indexOf(closingDelimiter, 4);
  if (closing === -1) {
    throw new Error(`project-doc-site: ${JSON.stringify(source)} has unclosed YAML frontmatter.`);
  }
  return markdown.slice(closing + closingDelimiter.length).replace(/^\n+/, "");
}
function rawMarkdownPageContent(markdown, source) {
  return withoutRepositoryChrome(withoutFrontmatter(markdown, source));
}
function indexAliasRoute(route) {
  const match = /^(.+)\/index\.md$/.exec(route);
  return match?.[1] === void 0 ? void 0 : `${match[1]}.md`;
}
function emitRawMarkdownPages(outDir, context = defaultProjectionContext()) {
  const aliases = context.pages.flatMap((page) => {
    const alias = indexAliasRoute(page.route);
    return alias === void 0 ? [] : [{ ...page, route: alias }];
  });
  projectPagesInto(
    outDir,
    context,
    (markdown, page) => rawMarkdownPageContent(markdown, page.source),
    [...context.pages, ...aliases]
  );
}
function rawMarkdownRoute(route, context = defaultProjectionContext()) {
  const page = context.pages.find((candidate) => candidate.route === route);
  if (page === void 0) return void 0;
  const markdown = readFileSync(resolve(context.repoRoot, page.source), "utf8");
  return rawMarkdownPageContent(rewriteMarkdown(markdown, {
    sourcePath: page.source,
    locale: page.locale,
    route: page.route,
    pages: context.pages,
    repoRoot: context.repoRoot,
    repositoryRef: context.repositoryRef,
    placeImage: (absPath) => `./${encodeURI(basename(absPath))}`
  }), page.source);
}
var llmsTxtLocales = [
  { heading: "\u7B80\u4F53\u4E2D\u6587", locale: "root" },
  { heading: "English", locale: "en" }
];
function llmsTxt(site) {
  const lines = [
    `# ${site.title}`,
    "",
    `> ${site.description}`,
    "",
    "\u9875\u9762 URL \u53BB\u6389\u672B\u5C3E\u659C\u6760\u518D\u52A0 `.md` \u5373\u4E3A\u8BE5\u9875\u539F\u59CB Markdown(\u6839\u8DEF\u5F84\u7528 `/index.md`);\u4E0B\u65B9\u5217\u8868\u662F\u5404\u9875\u7CBE\u786E\u5730\u5740\u3002Drop any trailing slash and append `.md` to a page URL for its raw Markdown (the site root is `/index.md`); the list below carries the exact addresses."
  ];
  for (const { heading, locale } of llmsTxtLocales) {
    lines.push("", `## ${heading}`, "");
    for (const collection of localeCollections[locale]) {
      for (const page of orderedPages(locale, collection)) {
        lines.push(`- [${page.label}](${site.base}${page.route}): ${page.section}`);
      }
    }
  }
  return `${lines.join("\n")}
`;
}

// website/.vitepress/config.ts
var __vite_injected_original_dirname2 = "E:\\Mix\\project\\deepseek-harness\\.worktrees\\upstream-first\\website\\.vitepress";
projectDocs();
function sidebar(locale, collection) {
  const groups = /* @__PURE__ */ new Map();
  for (const page of orderedPages(locale, collection)) {
    const entries = groups.get(page.section) ?? [];
    entries.push(page);
    groups.set(page.section, entries);
  }
  return [...groups.entries()].map(([text, entries]) => {
    const { collapsed } = sectionSpec(locale, text);
    return {
      text,
      // A present `collapsed` is what makes the default theme render the
      // group as collapsible at all, so an open group must omit the key.
      ...collapsed === void 0 ? {} : { collapsed },
      items: entries.map((page) => ({ text: page.label, link: routeLink(page.route) }))
    };
  });
}
var guideModules = {
  root: {
    guide: localeCollections.root[0],
    develop: { label: "\u5F00\u53D1", collection: localeCollections.root[1] },
    reference: { label: "\u53C2\u8003", collection: localeCollections.root[2] }
  },
  en: {
    guide: localeCollections.en[0],
    develop: { label: "Development", collection: localeCollections.en[1] },
    reference: { label: "Reference", collection: localeCollections.en[2] }
  }
};
function guideSidebar(locale) {
  const { guide, develop: develop2, reference: reference2 } = guideModules[locale];
  return [
    ...sidebar(locale, guide),
    ...[develop2, reference2].map(({ label, collection }) => ({
      text: label,
      link: landingLink(locale, collection)
    }))
  ];
}
function moduleNav(locale) {
  const { develop: develop2, reference: reference2 } = guideModules[locale];
  const routePrefix = locale === "root" ? "" : "/en";
  return [
    { text: develop2.label, link: landingLink(locale, develop2.collection), activeMatch: `^${routePrefix}/develop/` },
    { text: reference2.label, link: landingLink(locale, reference2.collection), activeMatch: `^${routePrefix}/reference/` }
  ];
}
function watchCanonicalDocs(server) {
  const sources = docsSourceFiles();
  server.watcher.add(sources);
  server.watcher.on("change", (changed) => {
    if (!sources.includes(changed)) return;
    projectDocs();
  });
}
function serveRawMarkdown(server) {
  server.middlewares.use((req, res, next) => {
    if (req.url === void 0 || req.method !== "GET" && req.method !== "HEAD") {
      next();
      return;
    }
    const fetchDest = req.headers["sec-fetch-dest"];
    if (fetchDest !== void 0 && fetchDest !== "document") {
      next();
      return;
    }
    const pathname = req.url.split(/[?#]/, 1)[0] ?? "";
    const sitePath = pathname.startsWith(base) ? pathname.slice(base.length) : pathname.replace(/^\//, "");
    if (sitePath === "llms.txt") {
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end(llmsTxt({ base, ...siteIdentity }));
      return;
    }
    const content = sitePath.endsWith(".md") ? rawMarkdownRoute(sitePath) : void 0;
    if (content === void 0) {
      next();
      return;
    }
    res.setHeader("Content-Type", "text/markdown; charset=utf-8");
    res.end(content);
  });
}
function escapeVueInterpolation(html) {
  return html.replaceAll("{{", "&#123;&#123;").replaceAll("}}", "&#125;&#125;");
}
var sharedTheme = {
  search: {
    provider: "local",
    options: {
      locales: {
        root: {
          translations: {
            button: {
              buttonText: "\u641C\u7D22\u6587\u6863",
              buttonAriaLabel: "\u641C\u7D22\u6587\u6863"
            },
            modal: {
              displayDetails: "\u663E\u793A\u8BE6\u7EC6\u5217\u8868",
              resetButtonTitle: "\u6E05\u9664\u641C\u7D22",
              backButtonTitle: "\u5173\u95ED\u641C\u7D22",
              noResultsText: "\u672A\u627E\u5230\u76F8\u5173\u7ED3\u679C",
              footer: {
                selectText: "\u9009\u62E9",
                selectKeyAriaLabel: "\u56DE\u8F66\u952E",
                navigateText: "\u5207\u6362",
                navigateUpKeyAriaLabel: "\u4E0A\u65B9\u5411\u952E",
                navigateDownKeyAriaLabel: "\u4E0B\u65B9\u5411\u952E",
                closeText: "\u5173\u95ED",
                closeKeyAriaLabel: "Esc \u952E"
              }
            }
          }
        }
      }
    }
  },
  socialLinks: [
    { icon: "github", link: "https://github.com/deepseek-ai/deepseek-harness" }
  ],
  editLink: {
    pattern: ({ frontmatter }) => {
      const data = frontmatter;
      const editSource = typeof data === "object" && data !== null ? Reflect.get(data, "editSource") : void 0;
      if (typeof editSource !== "string") throw new Error("Projected documentation page has no editSource frontmatter.");
      return `https://github.com/deepseek-ai/deepseek-harness/edit/master/${editSource}`;
    },
    text: "\u5728 GitHub \u4E0A\u7F16\u8F91\u6B64\u9875"
  }
};
var base = process.env.DOCS_BASE ?? "/";
var siteIdentity = {
  title: "DeepSeek Harness",
  description: "\u7528\u4E8E\u6784\u5EFA Agent Harness \u7684\u63D2\u4EF6\u5316 SDK"
};
var wordmark = readFileSync2(resolve2(__vite_injected_original_dirname2, "../public/wordmark.svg"), "utf8").trim().replace("<svg ", '<svg class="dsh-wordmark" ');
var siteStyle = `
.dsh-lockup { display: inline-flex; align-items: center; gap: 8px; min-width: 0; }
.dsh-wordmark { display: block; height: 22px; width: auto; color: var(--vp-c-text-1); }
.dsh-tag {
  display: inline-flex;
  align-items: center;
  border: 1px solid var(--vp-c-brand-soft);
  border-radius: 999px;
  padding: 1px 9px;
  font-size: 12px;
  font-weight: 500;
  line-height: 18px;
  white-space: nowrap;
  color: var(--vp-c-brand-1);
}

.VPSidebar::-webkit-scrollbar { width: 6px; }
.VPSidebar::-webkit-scrollbar-track { background: transparent; }
.VPSidebar::-webkit-scrollbar-thumb {
  background-color: transparent;
  border-radius: 3px;
  transition: background-color 0.3s;
}
.VPSidebar[data-scrolling]::-webkit-scrollbar-thumb { background-color: var(--vp-c-text-3); }
@supports not selector(::-webkit-scrollbar) {
  .VPSidebar { scrollbar-width: thin; scrollbar-color: transparent transparent; }
  .VPSidebar[data-scrolling] { scrollbar-color: var(--vp-c-text-3) transparent; }
}
`;
var scrollbarScript = `
(() => {
  let idle
  addEventListener('scroll', (event) => {
    const target = event.target
    if (!(target instanceof Element) || !target.classList.contains('VPSidebar')) return
    target.dataset.scrolling = ''
    clearTimeout(idle)
    idle = setTimeout(() => delete target.dataset.scrolling, 800)
  }, true)
})()
`;
function siteTitle(previewTag) {
  return `<span class="dsh-lockup">${wordmark}<span class="dsh-tag">${previewTag}</span></span>`;
}
var config_default = withMermaid({
  title: siteIdentity.title,
  description: siteIdentity.description,
  base,
  /** Emit the raw-Markdown twin of every route plus llms.txt beside the rendered site. */
  buildEnd(siteConfig) {
    emitRawMarkdownPages(siteConfig.outDir);
    writeFileSync2(resolve2(siteConfig.outDir, "llms.txt"), llmsTxt({ base, ...siteIdentity }));
  },
  head: [
    // VitePress leaves head hrefs untouched, so the base belongs here explicitly.
    ["link", { rel: "icon", type: "image/svg+xml", href: `${base}favicon.svg` }],
    ["style", {}, siteStyle],
    ["script", {}, scrollbarScript]
  ],
  cleanUrls: true,
  srcDir: ".generated",
  cacheDir: ".cache",
  outDir: ".dist",
  locales: {
    root: {
      label: "\u7B80\u4F53\u4E2D\u6587",
      lang: "zh-CN",
      themeConfig: {
        siteTitle: siteTitle("\u6280\u672F\u9884\u89C8"),
        nav: [
          { text: "\u5165\u95E8", link: landingLink("root", guideModules.root.guide), activeMatch: "^/guide/" },
          ...moduleNav("root")
        ],
        sidebar: {
          "/guide/": guideSidebar("root"),
          "/develop/": sidebar("root", "zh-develop"),
          "/reference/": sidebar("root", "zh-reference")
        },
        outline: { label: "\u672C\u9875\u76EE\u5F55" },
        docFooter: { prev: "\u4E0A\u4E00\u7BC7", next: "\u4E0B\u4E00\u7BC7" },
        darkModeSwitchLabel: "\u5916\u89C2",
        lightModeSwitchTitle: "\u5207\u6362\u5230\u6D45\u8272\u4E3B\u9898",
        darkModeSwitchTitle: "\u5207\u6362\u5230\u6DF1\u8272\u4E3B\u9898",
        sidebarMenuLabel: "\u83DC\u5355",
        returnToTopLabel: "\u8FD4\u56DE\u9876\u90E8",
        langMenuLabel: "\u5207\u6362\u8BED\u8A00",
        skipToContentLabel: "\u8DF3\u81F3\u5185\u5BB9"
      }
    },
    en: {
      label: "English",
      lang: "en-US",
      link: "/en/",
      themeConfig: {
        siteTitle: siteTitle("Preview"),
        nav: [
          { text: "Guide", link: landingLink("en", guideModules.en.guide), activeMatch: "^/en/guide/" },
          ...moduleNav("en")
        ],
        sidebar: {
          "/en/guide/": guideSidebar("en"),
          "/en/develop/": sidebar("en", "en-develop"),
          "/en/reference/": sidebar("en", "en-reference")
        },
        editLink: {
          pattern: ({ frontmatter }) => {
            const data = frontmatter;
            const editSource = typeof data === "object" && data !== null ? Reflect.get(data, "editSource") : void 0;
            if (typeof editSource !== "string") throw new Error("Projected documentation page has no editSource frontmatter.");
            return `https://github.com/deepseek-ai/deepseek-harness/edit/master/${editSource}`;
          },
          text: "Edit this page on GitHub"
        },
        outline: { label: "On this page" },
        docFooter: { prev: "Previous", next: "Next" }
      }
    }
  },
  vite: {
    // `srcDir` puts the Vite root inside the disposable generated tree, whose
    // own `public/` no tracked asset can live in.
    publicDir: resolve2(__vite_injected_original_dirname2, "../public"),
    plugins: [
      {
        name: "deepseek-harness-doc-projector",
        configureServer(server) {
          watchCanonicalDocs(server);
          serveRawMarkdown(server);
        }
      }
    ]
  },
  markdown: {
    config(md) {
      const renderText = md.renderer.rules.text;
      const renderCode = md.renderer.rules.code_inline;
      const renderFence = md.renderer.rules.fence;
      if (renderText === void 0) throw new Error("VitePress Markdown renderer is missing the text rendering rule.");
      if (renderCode === void 0) throw new Error("VitePress Markdown renderer is missing the inline-code rendering rule.");
      if (renderFence === void 0) throw new Error("VitePress Markdown renderer is missing the fence rendering rule.");
      md.renderer.rules.text = (...args) => escapeVueInterpolation(renderText(...args));
      md.renderer.rules.code_inline = (...args) => escapeVueInterpolation(renderCode(...args));
      const renderedFences = /* @__PURE__ */ new Map();
      md.renderer.rules.fence = (...args) => {
        const [tokens, index] = args;
        const token = tokens[index];
        if (token === void 0) throw new Error("VitePress code-fence renderer received no token.");
        if (["mermaid", "mmd"].includes(token.info.trim().split(/\s+/, 1)[0] ?? "")) return renderFence(...args);
        if (Reflect.get(token, "src") !== void 0) return renderFence(...args);
        if (process.env.NODE_ENV !== "production") return renderFence(...args);
        const key = JSON.stringify([token.content, token.info, token.markup, token.attrs]);
        const cached = renderedFences.get(key);
        if (cached !== void 0) return cached;
        const html = renderFence(...args);
        renderedFences.set(key, html);
        return html;
      };
    }
  },
  mermaid: {},
  themeConfig: sharedTheme
});
export {
  config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsid2Vic2l0ZS8udml0ZXByZXNzL2NvbmZpZy50cyIsICJ3ZWJzaXRlL2RvY3MudHMiLCAic2NyaXB0cy9wcm9qZWN0LWRvYy1zaXRlLnRzIiwgInNjcmlwdHMvbWFya2Rvd24udHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCJFOlxcXFxNaXhcXFxccHJvamVjdFxcXFxkZWVwc2Vlay1oYXJuZXNzXFxcXC53b3JrdHJlZXNcXFxcdXBzdHJlYW0tZmlyc3RcXFxcd2Vic2l0ZVxcXFwudml0ZXByZXNzXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ZpbGVuYW1lID0gXCJFOlxcXFxNaXhcXFxccHJvamVjdFxcXFxkZWVwc2Vlay1oYXJuZXNzXFxcXC53b3JrdHJlZXNcXFxcdXBzdHJlYW0tZmlyc3RcXFxcd2Vic2l0ZVxcXFwudml0ZXByZXNzXFxcXGNvbmZpZy50c1wiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9pbXBvcnRfbWV0YV91cmwgPSBcImZpbGU6Ly8vRTovTWl4L3Byb2plY3QvZGVlcHNlZWstaGFybmVzcy8ud29ya3RyZWVzL3Vwc3RyZWFtLWZpcnN0L3dlYnNpdGUvLnZpdGVwcmVzcy9jb25maWcudHNcIjsvKiogVml0ZVByZXNzIGNvbmZpZ3VyYXRpb24gZm9yIHRoZSBsb2NhbGx5IHByb2plY3RlZCBkb2N1bWVudGF0aW9uIHNpdGUuICovXG5cbmltcG9ydCB7IHJlYWRGaWxlU3luYywgd3JpdGVGaWxlU3luYyB9IGZyb20gJ25vZGU6ZnMnXG5pbXBvcnQgeyByZXNvbHZlIH0gZnJvbSAnbm9kZTpwYXRoJ1xuaW1wb3J0IHR5cGUgeyBEZWZhdWx0VGhlbWUsIFBhZ2VEYXRhLCBTaXRlQ29uZmlnIH0gZnJvbSAndml0ZXByZXNzJ1xuaW1wb3J0IHR5cGUgeyBWaXRlRGV2U2VydmVyIH0gZnJvbSAndml0ZSdcbmltcG9ydCB7IHdpdGhNZXJtYWlkIH0gZnJvbSAndml0ZXByZXNzLXBsdWdpbi1tZXJtYWlkJ1xuaW1wb3J0IHsgbGFuZGluZ0xpbmssIGxvY2FsZUNvbGxlY3Rpb25zLCBvcmRlcmVkUGFnZXMsIHJvdXRlTGluaywgc2VjdGlvblNwZWMsIHR5cGUgRG9jc0xvY2FsZSwgdHlwZSBEb2NzUGFnZSwgdHlwZSBEb2NzU2lkZWJhciB9IGZyb20gJy4uL2RvY3MudHMnXG5pbXBvcnQgeyBkb2NzU291cmNlRmlsZXMsIGVtaXRSYXdNYXJrZG93blBhZ2VzLCBsbG1zVHh0LCBwcm9qZWN0RG9jcywgcmF3TWFya2Rvd25Sb3V0ZSB9IGZyb20gJy4uLy4uL3NjcmlwdHMvcHJvamVjdC1kb2Mtc2l0ZS50cydcblxucHJvamVjdERvY3MoKVxuXG5mdW5jdGlvbiBzaWRlYmFyKGxvY2FsZTogRG9jc0xvY2FsZSwgY29sbGVjdGlvbjogTm9uTnVsbGFibGU8RG9jc1BhZ2VbJ3NpZGViYXInXT4pOiBEZWZhdWx0VGhlbWUuU2lkZWJhckl0ZW1bXSB7XG4gIC8vIGBvcmRlcmVkUGFnZXNgIGFscmVhZHkgc29ydHMgYnkgc2VjdGlvbiBwbGFjZW1lbnQsIHNvIGluc2VydGlvbiBvcmRlclxuICAvLyBjYXJyaWVzIHRoZSBncm91cCBvcmRlciBhbmQgZWFjaCBncm91cCBrZWVwcyBpdHMgcGFnZXMgaW4gc2VxdWVuY2UuXG4gIGNvbnN0IGdyb3VwcyA9IG5ldyBNYXA8c3RyaW5nLCBEb2NzUGFnZVtdPigpXG4gIGZvciAoY29uc3QgcGFnZSBvZiBvcmRlcmVkUGFnZXMobG9jYWxlLCBjb2xsZWN0aW9uKSkge1xuICAgIGNvbnN0IGVudHJpZXMgPSBncm91cHMuZ2V0KHBhZ2Uuc2VjdGlvbikgPz8gW11cbiAgICBlbnRyaWVzLnB1c2gocGFnZSlcbiAgICBncm91cHMuc2V0KHBhZ2Uuc2VjdGlvbiwgZW50cmllcylcbiAgfVxuICByZXR1cm4gWy4uLmdyb3Vwcy5lbnRyaWVzKCldLm1hcCgoW3RleHQsIGVudHJpZXNdKSA9PiB7XG4gICAgY29uc3QgeyBjb2xsYXBzZWQgfSA9IHNlY3Rpb25TcGVjKGxvY2FsZSwgdGV4dClcbiAgICByZXR1cm4ge1xuICAgICAgdGV4dCxcbiAgICAgIC8vIEEgcHJlc2VudCBgY29sbGFwc2VkYCBpcyB3aGF0IG1ha2VzIHRoZSBkZWZhdWx0IHRoZW1lIHJlbmRlciB0aGVcbiAgICAgIC8vIGdyb3VwIGFzIGNvbGxhcHNpYmxlIGF0IGFsbCwgc28gYW4gb3BlbiBncm91cCBtdXN0IG9taXQgdGhlIGtleS5cbiAgICAgIC4uLihjb2xsYXBzZWQgPT09IHVuZGVmaW5lZCA/IHt9IDogeyBjb2xsYXBzZWQgfSksXG4gICAgICBpdGVtczogZW50cmllcy5tYXAocGFnZSA9PiAoeyB0ZXh0OiBwYWdlLmxhYmVsLCBsaW5rOiByb3V0ZUxpbmsocGFnZS5yb3V0ZSkgfSkpLFxuICAgIH1cbiAgfSlcbn1cblxuLyoqIE9uZSBtb2R1bGUgbGluayBzaGFyZWQgYmV0d2VlbiB0aGUgbmF2aWdhdGlvbiBiYXIgYW5kIHRoZSBndWlkZSBzaWRlYmFyLiAqL1xuaW50ZXJmYWNlIEd1aWRlTW9kdWxlTGluayB7XG4gIC8qKiBMYWJlbCBzaG93biBpbiB0aGUgbmF2aWdhdGlvbiBiYXIgYW5kIHRoZSBndWlkZSBzaWRlYmFyLiAqL1xuICBsYWJlbDogc3RyaW5nXG4gIC8qKiBTaWRlYmFyIGNvbGxlY3Rpb24gdGhlIGxpbmsgb3BlbnMuICovXG4gIGNvbGxlY3Rpb246IERvY3NTaWRlYmFyXG59XG5cbi8qKlxuICogUGVyLWxvY2FsZSBndWlkZS1tb2R1bGUgZmFjdHM6IHRoZSBndWlkZSBjb2xsZWN0aW9uIGFuZCB0aGUgbW9kdWxlIGxpbmtzXG4gKiBhcHBlbmRlZCB0byB0aGUgZ3VpZGUgc2lkZWJhci5cbiAqL1xuaW50ZXJmYWNlIEd1aWRlTW9kdWxlcyB7XG4gIC8qKiBHdWlkZSBzaWRlYmFyIGNvbGxlY3Rpb24gZm9yIHRoZSBsb2NhbGUuICovXG4gIGd1aWRlOiAnemgtZ3VpZGUnIHwgJ2VuLWd1aWRlJ1xuICAvKiogRGV2ZWxvcG1lbnQgbW9kdWxlIGxpbmsuICovXG4gIGRldmVsb3A6IEd1aWRlTW9kdWxlTGlua1xuICAvKiogUmVmZXJlbmNlIG1vZHVsZSBsaW5rLiAqL1xuICByZWZlcmVuY2U6IEd1aWRlTW9kdWxlTGlua1xufVxuXG4vKipcbiAqIEd1aWRlLW1vZHVsZSBmYWN0cyBrZXllZCBieSBsb2NhbGUsIGdpdmluZyBldmVyeSBtb2R1bGUgbGFiZWwgYW5kIGNvbGxlY3Rpb25cbiAqIG9uZSBob21lIHNoYXJlZCBieSB0aGUgbmF2aWdhdGlvbiBiYXIgYW5kIHRoZSBndWlkZSBzaWRlYmFyLlxuICovXG5jb25zdCBndWlkZU1vZHVsZXMgPSB7XG4gIHJvb3Q6IHtcbiAgICBndWlkZTogbG9jYWxlQ29sbGVjdGlvbnMucm9vdFswXSxcbiAgICBkZXZlbG9wOiB7IGxhYmVsOiAnXHU1RjAwXHU1M0QxJywgY29sbGVjdGlvbjogbG9jYWxlQ29sbGVjdGlvbnMucm9vdFsxXSB9LFxuICAgIHJlZmVyZW5jZTogeyBsYWJlbDogJ1x1NTNDMlx1ODAwMycsIGNvbGxlY3Rpb246IGxvY2FsZUNvbGxlY3Rpb25zLnJvb3RbMl0gfSxcbiAgfSxcbiAgZW46IHtcbiAgICBndWlkZTogbG9jYWxlQ29sbGVjdGlvbnMuZW5bMF0sXG4gICAgZGV2ZWxvcDogeyBsYWJlbDogJ0RldmVsb3BtZW50JywgY29sbGVjdGlvbjogbG9jYWxlQ29sbGVjdGlvbnMuZW5bMV0gfSxcbiAgICByZWZlcmVuY2U6IHsgbGFiZWw6ICdSZWZlcmVuY2UnLCBjb2xsZWN0aW9uOiBsb2NhbGVDb2xsZWN0aW9ucy5lblsyXSB9LFxuICB9LFxufSBzYXRpc2ZpZXMgUmVjb3JkPERvY3NMb2NhbGUsIEd1aWRlTW9kdWxlcz5cblxuLyoqXG4gKiBHdWlkZSBzaWRlYmFyIHdpdGggZGlyZWN0IGxpbmtzIGludG8gdGhlIGZpcnN0IGRldmVsb3BtZW50IGFuZCByZWZlcmVuY2UgcGFnZXMuXG4gKlxuICogQHBhcmFtIGxvY2FsZSAtIFJvdXRlIHRyZWUgd2hvc2UgZ3VpZGUgc2lkZWJhciBpcyBiZWluZyBidWlsdC5cbiAqIEByZXR1cm5zIEd1aWRlIGdyb3VwcyBmb2xsb3dlZCBieSB0b3AtbGV2ZWwgbGlua3MgdG8gdGhlIG90aGVyIGRvY3VtZW50YXRpb24gbW9kdWxlcy5cbiAqL1xuZnVuY3Rpb24gZ3VpZGVTaWRlYmFyKGxvY2FsZTogRG9jc0xvY2FsZSk6IERlZmF1bHRUaGVtZS5TaWRlYmFySXRlbVtdIHtcbiAgY29uc3QgeyBndWlkZSwgZGV2ZWxvcCwgcmVmZXJlbmNlIH0gPSBndWlkZU1vZHVsZXNbbG9jYWxlXVxuICByZXR1cm4gW1xuICAgIC4uLnNpZGViYXIobG9jYWxlLCBndWlkZSksXG4gICAgLi4uW2RldmVsb3AsIHJlZmVyZW5jZV0ubWFwKCh7IGxhYmVsLCBjb2xsZWN0aW9uIH0pID0+ICh7XG4gICAgICB0ZXh0OiBsYWJlbCxcbiAgICAgIGxpbms6IGxhbmRpbmdMaW5rKGxvY2FsZSwgY29sbGVjdGlvbiksXG4gICAgfSkpLFxuICBdXG59XG5cbi8qKlxuICogTmF2aWdhdGlvbi1iYXIgaXRlbXMgZm9yIHRoZSBtb2R1bGVzIHRoZSBndWlkZSBzaWRlYmFyIGxpbmtzIGludG8sIHJlYWRpbmdcbiAqIHRoZWlyIGxhYmVscyBhbmQgY29sbGVjdGlvbnMgZnJvbSB0aGUgc2hhcmVkIHBlci1sb2NhbGUgcmVjb3JkLlxuICpcbiAqIEBwYXJhbSBsb2NhbGUgLSBSb3V0ZSB0cmVlIHRoZSBuYXZpZ2F0aW9uIGl0ZW1zIGJlbG9uZyB0by5cbiAqIEByZXR1cm5zIFRoZSBtb2R1bGUgaXRlbXMgZm9yIHRoZSBsb2NhbGUncyBuYXZpZ2F0aW9uIGJhci5cbiAqL1xuZnVuY3Rpb24gbW9kdWxlTmF2KGxvY2FsZTogRG9jc0xvY2FsZSk6IERlZmF1bHRUaGVtZS5OYXZJdGVtW10ge1xuICBjb25zdCB7IGRldmVsb3AsIHJlZmVyZW5jZSB9ID0gZ3VpZGVNb2R1bGVzW2xvY2FsZV1cbiAgY29uc3Qgcm91dGVQcmVmaXggPSBsb2NhbGUgPT09ICdyb290JyA/ICcnIDogJy9lbidcbiAgcmV0dXJuIFtcbiAgICB7IHRleHQ6IGRldmVsb3AubGFiZWwsIGxpbms6IGxhbmRpbmdMaW5rKGxvY2FsZSwgZGV2ZWxvcC5jb2xsZWN0aW9uKSwgYWN0aXZlTWF0Y2g6IGBeJHtyb3V0ZVByZWZpeH0vZGV2ZWxvcC9gIH0sXG4gICAgeyB0ZXh0OiByZWZlcmVuY2UubGFiZWwsIGxpbms6IGxhbmRpbmdMaW5rKGxvY2FsZSwgcmVmZXJlbmNlLmNvbGxlY3Rpb24pLCBhY3RpdmVNYXRjaDogYF4ke3JvdXRlUHJlZml4fS9yZWZlcmVuY2UvYCB9LFxuICBdXG59XG5cbmZ1bmN0aW9uIHdhdGNoQ2Fub25pY2FsRG9jcyhzZXJ2ZXI6IFZpdGVEZXZTZXJ2ZXIpOiB2b2lkIHtcbiAgY29uc3Qgc291cmNlcyA9IGRvY3NTb3VyY2VGaWxlcygpXG4gIHNlcnZlci53YXRjaGVyLmFkZChzb3VyY2VzKVxuICBzZXJ2ZXIud2F0Y2hlci5vbignY2hhbmdlJywgKGNoYW5nZWQpID0+IHtcbiAgICBpZiAoIXNvdXJjZXMuaW5jbHVkZXMoY2hhbmdlZCkpIHJldHVyblxuICAgIHByb2plY3REb2NzKClcbiAgfSlcbn1cblxuLyoqXG4gKiBTZXJ2ZSB0aGUgcmF3LU1hcmtkb3duIHR3aW4gb2YgZWFjaCByb3V0ZSBhbmQgbGxtcy50eHQgZHVyaW5nIGRldmVsb3BtZW50LFxuICogbWF0Y2hpbmcgd2hhdCBgYnVpbGRFbmRgIGVtaXRzIGludG8gdGhlIHN0YXRpYyBidWlsZC4gUGFnZXMgcHJvamVjdCBmcm9tXG4gKiB0aGVpciBjYW5vbmljYWwgc291cmNlcyBwZXIgcmVxdWVzdCwgc28gYW4gZWRpdCBzaG93cyB3aXRob3V0IGEgcmVidWlsZC5cbiAqL1xuZnVuY3Rpb24gc2VydmVSYXdNYXJrZG93bihzZXJ2ZXI6IFZpdGVEZXZTZXJ2ZXIpOiB2b2lkIHtcbiAgc2VydmVyLm1pZGRsZXdhcmVzLnVzZSgocmVxLCByZXMsIG5leHQpID0+IHtcbiAgICBpZiAocmVxLnVybCA9PT0gdW5kZWZpbmVkIHx8IChyZXEubWV0aG9kICE9PSAnR0VUJyAmJiByZXEubWV0aG9kICE9PSAnSEVBRCcpKSB7XG4gICAgICBuZXh0KClcbiAgICAgIHJldHVyblxuICAgIH1cbiAgICAvLyBUaGUgZGV2IGNsaWVudCBpbXBvcnRzIHBhZ2UgbW9kdWxlcyBhdCB0aGVzZSBzYW1lIGAubWRgIFVSTHMsIGFuZCBhXG4gICAgLy8gbW9kdWxlIHNjcmlwdCBtdXN0IHJlYWNoIFZpdGUncyB0cmFuc2Zvcm0uIEJyb3dzZXJzIGRlY2xhcmUgdGhlIHB1cnBvc2U6XG4gICAgLy8gYHNjcmlwdGAgZm9yIG1vZHVsZSBpbXBvcnRzLCBgZG9jdW1lbnRgIGZvciBhZGRyZXNzLWJhciBuYXZpZ2F0aW9uLlxuICAgIC8vIEhlYWRlci1sZXNzIGNsaWVudHMgKGN1cmwsIGFnZW50cykgcmVhZCB0aGUgcmF3IHR3aW4uIEluLXBhZ2UgZmV0Y2goKVxuICAgIC8vIChgZW1wdHlgKSBhbHNvIHBhc3NlcyB0byBWaXRlIFx1MjAxNCBhIGRlbGliZXJhdGUgZGV2LW9ubHkgZGl2ZXJnZW5jZSB0aGF0XG4gICAgLy8ga2VlcHMgVml0ZSdzIG93biByZXF1ZXN0cyB1bmJyb2tlbiwgd2hpbGUgcHJvZHVjdGlvbiBzdGF0aWMgaG9zdGluZ1xuICAgIC8vIGFuc3dlcnMgc3VjaCBhIGZldGNoIHdpdGggdGhlIHJhdyBmaWxlLlxuICAgIGNvbnN0IGZldGNoRGVzdCA9IHJlcS5oZWFkZXJzWydzZWMtZmV0Y2gtZGVzdCddXG4gICAgaWYgKGZldGNoRGVzdCAhPT0gdW5kZWZpbmVkICYmIGZldGNoRGVzdCAhPT0gJ2RvY3VtZW50Jykge1xuICAgICAgbmV4dCgpXG4gICAgICByZXR1cm5cbiAgICB9XG4gICAgY29uc3QgcGF0aG5hbWUgPSByZXEudXJsLnNwbGl0KC9bPyNdLywgMSlbMF0gPz8gJydcbiAgICBjb25zdCBzaXRlUGF0aCA9IHBhdGhuYW1lLnN0YXJ0c1dpdGgoYmFzZSkgPyBwYXRobmFtZS5zbGljZShiYXNlLmxlbmd0aCkgOiBwYXRobmFtZS5yZXBsYWNlKC9eXFwvLywgJycpXG4gICAgaWYgKHNpdGVQYXRoID09PSAnbGxtcy50eHQnKSB7XG4gICAgICByZXMuc2V0SGVhZGVyKCdDb250ZW50LVR5cGUnLCAndGV4dC9wbGFpbjsgY2hhcnNldD11dGYtOCcpXG4gICAgICByZXMuZW5kKGxsbXNUeHQoeyBiYXNlLCAuLi5zaXRlSWRlbnRpdHkgfSkpXG4gICAgICByZXR1cm5cbiAgICB9XG4gICAgY29uc3QgY29udGVudCA9IHNpdGVQYXRoLmVuZHNXaXRoKCcubWQnKSA/IHJhd01hcmtkb3duUm91dGUoc2l0ZVBhdGgpIDogdW5kZWZpbmVkXG4gICAgaWYgKGNvbnRlbnQgPT09IHVuZGVmaW5lZCkge1xuICAgICAgbmV4dCgpXG4gICAgICByZXR1cm5cbiAgICB9XG4gICAgcmVzLnNldEhlYWRlcignQ29udGVudC1UeXBlJywgJ3RleHQvbWFya2Rvd247IGNoYXJzZXQ9dXRmLTgnKVxuICAgIHJlcy5lbmQoY29udGVudClcbiAgfSlcbn1cblxuZnVuY3Rpb24gZXNjYXBlVnVlSW50ZXJwb2xhdGlvbihodG1sOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gaHRtbC5yZXBsYWNlQWxsKCd7eycsICcmIzEyMzsmIzEyMzsnKS5yZXBsYWNlQWxsKCd9fScsICcmIzEyNTsmIzEyNTsnKVxufVxuXG5jb25zdCBzaGFyZWRUaGVtZTogUGljazxEZWZhdWx0VGhlbWUuQ29uZmlnLCAnc2VhcmNoJyB8ICdzb2NpYWxMaW5rcycgfCAnZWRpdExpbmsnPiA9IHtcbiAgc2VhcmNoOiB7XG4gICAgcHJvdmlkZXI6ICdsb2NhbCcsXG4gICAgb3B0aW9uczoge1xuICAgICAgbG9jYWxlczoge1xuICAgICAgICByb290OiB7XG4gICAgICAgICAgdHJhbnNsYXRpb25zOiB7XG4gICAgICAgICAgICBidXR0b246IHtcbiAgICAgICAgICAgICAgYnV0dG9uVGV4dDogJ1x1NjQxQ1x1N0QyMlx1NjU4N1x1Njg2MycsXG4gICAgICAgICAgICAgIGJ1dHRvbkFyaWFMYWJlbDogJ1x1NjQxQ1x1N0QyMlx1NjU4N1x1Njg2MycsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgbW9kYWw6IHtcbiAgICAgICAgICAgICAgZGlzcGxheURldGFpbHM6ICdcdTY2M0VcdTc5M0FcdThCRTZcdTdFQzZcdTUyMTdcdTg4NjgnLFxuICAgICAgICAgICAgICByZXNldEJ1dHRvblRpdGxlOiAnXHU2RTA1XHU5NjY0XHU2NDFDXHU3RDIyJyxcbiAgICAgICAgICAgICAgYmFja0J1dHRvblRpdGxlOiAnXHU1MTczXHU5NUVEXHU2NDFDXHU3RDIyJyxcbiAgICAgICAgICAgICAgbm9SZXN1bHRzVGV4dDogJ1x1NjcyQVx1NjI3RVx1NTIzMFx1NzZGOFx1NTE3M1x1N0VEM1x1Njc5QycsXG4gICAgICAgICAgICAgIGZvb3Rlcjoge1xuICAgICAgICAgICAgICAgIHNlbGVjdFRleHQ6ICdcdTkwMDlcdTYyRTknLFxuICAgICAgICAgICAgICAgIHNlbGVjdEtleUFyaWFMYWJlbDogJ1x1NTZERVx1OEY2Nlx1OTUyRScsXG4gICAgICAgICAgICAgICAgbmF2aWdhdGVUZXh0OiAnXHU1MjA3XHU2MzYyJyxcbiAgICAgICAgICAgICAgICBuYXZpZ2F0ZVVwS2V5QXJpYUxhYmVsOiAnXHU0RTBBXHU2NUI5XHU1NDExXHU5NTJFJyxcbiAgICAgICAgICAgICAgICBuYXZpZ2F0ZURvd25LZXlBcmlhTGFiZWw6ICdcdTRFMEJcdTY1QjlcdTU0MTFcdTk1MkUnLFxuICAgICAgICAgICAgICAgIGNsb3NlVGV4dDogJ1x1NTE3M1x1OTVFRCcsXG4gICAgICAgICAgICAgICAgY2xvc2VLZXlBcmlhTGFiZWw6ICdFc2MgXHU5NTJFJyxcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICAgIH0sXG4gICAgfSxcbiAgfSxcbiAgc29jaWFsTGlua3M6IFtcbiAgICB7IGljb246ICdnaXRodWInLCBsaW5rOiAnaHR0cHM6Ly9naXRodWIuY29tL2RlZXBzZWVrLWFpL2RlZXBzZWVrLWhhcm5lc3MnIH0sXG4gIF0sXG4gIGVkaXRMaW5rOiB7XG4gICAgcGF0dGVybjogKHsgZnJvbnRtYXR0ZXIgfTogUGFnZURhdGEpID0+IHtcbiAgICAgIGNvbnN0IGRhdGE6IHVua25vd24gPSBmcm9udG1hdHRlclxuICAgICAgY29uc3QgZWRpdFNvdXJjZTogdW5rbm93biA9IHR5cGVvZiBkYXRhID09PSAnb2JqZWN0JyAmJiBkYXRhICE9PSBudWxsID8gUmVmbGVjdC5nZXQoZGF0YSwgJ2VkaXRTb3VyY2UnKSA6IHVuZGVmaW5lZFxuICAgICAgaWYgKHR5cGVvZiBlZGl0U291cmNlICE9PSAnc3RyaW5nJykgdGhyb3cgbmV3IEVycm9yKCdQcm9qZWN0ZWQgZG9jdW1lbnRhdGlvbiBwYWdlIGhhcyBubyBlZGl0U291cmNlIGZyb250bWF0dGVyLicpXG4gICAgICByZXR1cm4gYGh0dHBzOi8vZ2l0aHViLmNvbS9kZWVwc2Vlay1haS9kZWVwc2Vlay1oYXJuZXNzL2VkaXQvbWFzdGVyLyR7ZWRpdFNvdXJjZX1gXG4gICAgfSxcbiAgICB0ZXh0OiAnXHU1NzI4IEdpdEh1YiBcdTRFMEFcdTdGMTZcdThGOTFcdTZCNjRcdTk4NzUnLFxuICB9LFxufVxuXG4vKiogU2l0ZSBiYXNlIHBhdGgsIGNhcnJ5aW5nIHRoZSBsZWFkaW5nIGFuZCB0cmFpbGluZyBzbGFzaGVzIFZpdGVQcmVzcyByZXF1aXJlcy4gKi9cbmNvbnN0IGJhc2UgPSBwcm9jZXNzLmVudi5ET0NTX0JBU0UgPz8gJy8nXG5cbi8qKiBTaXRlIGlkZW50aXR5IHNoYXJlZCBieSB0aGUgVml0ZVByZXNzIGNvbmZpZ3VyYXRpb24gYW5kIHRoZSBsbG1zLnR4dCBpbmRleC4gKi9cbmNvbnN0IHNpdGVJZGVudGl0eSA9IHtcbiAgdGl0bGU6ICdEZWVwU2VlayBIYXJuZXNzJyxcbiAgZGVzY3JpcHRpb246ICdcdTc1MjhcdTRFOEVcdTY3ODRcdTVFRkEgQWdlbnQgSGFybmVzcyBcdTc2ODRcdTYzRDJcdTRFRjZcdTUzMTYgU0RLJyxcbn1cblxuLyoqXG4gKiBUaGUgRGVlcFNlZWsgd29yZG1hcmssIGlubGluZWQgc28gaXRzIGBjdXJyZW50Q29sb3JgIGZpbGxzIGZvbGxvdyB0aGUgYWN0aXZlXG4gKiB0aGVtZS4gQW4gYDxpbWc+YCB3b3VsZCBmcmVlemUgdGhlIG1hcmsgYXQgdGhlIGNvbG9ycyB0aGUgZmlsZSBkZWNsYXJlcy5cbiAqL1xuY29uc3Qgd29yZG1hcmsgPSByZWFkRmlsZVN5bmMocmVzb2x2ZShpbXBvcnQubWV0YS5kaXJuYW1lLCAnLi4vcHVibGljL3dvcmRtYXJrLnN2ZycpLCAndXRmOCcpXG4gIC50cmltKClcbiAgLnJlcGxhY2UoJzxzdmcgJywgJzxzdmcgY2xhc3M9XCJkc2gtd29yZG1hcmtcIiAnKVxuXG4vKipcbiAqIFN0eWxlcyB0aGUgZGVmYXVsdCB0aGVtZSBkb2VzIG5vdCBwcm92aWRlLCBjYXJyaWVkIGlubGluZSBiZWNhdXNlIHRoZSBzaXRlXG4gKiBydW5zIHRoZSBzdG9jayB0aGVtZSB3aXRoIG5vIHRoZW1lIGRpcmVjdG9yeSBvZiBpdHMgb3duLlxuICpcbiAqIFRoZSBuYXZpZ2F0aW9uLWJhciBsb2NrdXAgcGFpcnMgd2l0aCBgc2l0ZVRpdGxlYC4gVGhlIHNjcm9sbGJhciBydWxlcyByZXBsYWNlXG4gKiB0aGUgc2lkZWJhcidzIHBsYXRmb3JtIGJhciwgd2hpY2ggcmVzZXJ2ZXMgMTVweCBvZiBhIDI2NXB4IGNvbHVtbiBhbmQgZHJhd3MgYVxuICogdHJhY2sgdGhlIHJlc3Qgb2YgdGhlIG5hdmlnYXRpb24gaGFzIG5vIGJvcmRlciBmb3I7IGBzY3JvbGxiYXJTY3JpcHRgIHN1cHBsaWVzXG4gKiB0aGUgbWFya2VyIHRoYXQgcmV2ZWFscyB0aGUgdGh1bWIuIENocm9tZSBkcm9wcyBgOjotd2Via2l0LXNjcm9sbGJhcmAgb25jZVxuICogYHNjcm9sbGJhci13aWR0aGAgaXMgc2V0IHRvIGFueXRoaW5nIGJ1dCBgYXV0b2AsIHNvIHRoZSBzdGFuZGFyZCBwcm9wZXJ0aWVzXG4gKiBzdGF5IGJlaGluZCBhIHF1ZXJ5IG9ubHkgRmlyZWZveCBhbnN3ZXJzLlxuICovXG5jb25zdCBzaXRlU3R5bGUgPSBgXG4uZHNoLWxvY2t1cCB7IGRpc3BsYXk6IGlubGluZS1mbGV4OyBhbGlnbi1pdGVtczogY2VudGVyOyBnYXA6IDhweDsgbWluLXdpZHRoOiAwOyB9XG4uZHNoLXdvcmRtYXJrIHsgZGlzcGxheTogYmxvY2s7IGhlaWdodDogMjJweDsgd2lkdGg6IGF1dG87IGNvbG9yOiB2YXIoLS12cC1jLXRleHQtMSk7IH1cbi5kc2gtdGFnIHtcbiAgZGlzcGxheTogaW5saW5lLWZsZXg7XG4gIGFsaWduLWl0ZW1zOiBjZW50ZXI7XG4gIGJvcmRlcjogMXB4IHNvbGlkIHZhcigtLXZwLWMtYnJhbmQtc29mdCk7XG4gIGJvcmRlci1yYWRpdXM6IDk5OXB4O1xuICBwYWRkaW5nOiAxcHggOXB4O1xuICBmb250LXNpemU6IDEycHg7XG4gIGZvbnQtd2VpZ2h0OiA1MDA7XG4gIGxpbmUtaGVpZ2h0OiAxOHB4O1xuICB3aGl0ZS1zcGFjZTogbm93cmFwO1xuICBjb2xvcjogdmFyKC0tdnAtYy1icmFuZC0xKTtcbn1cblxuLlZQU2lkZWJhcjo6LXdlYmtpdC1zY3JvbGxiYXIgeyB3aWR0aDogNnB4OyB9XG4uVlBTaWRlYmFyOjotd2Via2l0LXNjcm9sbGJhci10cmFjayB7IGJhY2tncm91bmQ6IHRyYW5zcGFyZW50OyB9XG4uVlBTaWRlYmFyOjotd2Via2l0LXNjcm9sbGJhci10aHVtYiB7XG4gIGJhY2tncm91bmQtY29sb3I6IHRyYW5zcGFyZW50O1xuICBib3JkZXItcmFkaXVzOiAzcHg7XG4gIHRyYW5zaXRpb246IGJhY2tncm91bmQtY29sb3IgMC4zcztcbn1cbi5WUFNpZGViYXJbZGF0YS1zY3JvbGxpbmddOjotd2Via2l0LXNjcm9sbGJhci10aHVtYiB7IGJhY2tncm91bmQtY29sb3I6IHZhcigtLXZwLWMtdGV4dC0zKTsgfVxuQHN1cHBvcnRzIG5vdCBzZWxlY3Rvcig6Oi13ZWJraXQtc2Nyb2xsYmFyKSB7XG4gIC5WUFNpZGViYXIgeyBzY3JvbGxiYXItd2lkdGg6IHRoaW47IHNjcm9sbGJhci1jb2xvcjogdHJhbnNwYXJlbnQgdHJhbnNwYXJlbnQ7IH1cbiAgLlZQU2lkZWJhcltkYXRhLXNjcm9sbGluZ10geyBzY3JvbGxiYXItY29sb3I6IHZhcigtLXZwLWMtdGV4dC0zKSB0cmFuc3BhcmVudDsgfVxufVxuYFxuXG4vKipcbiAqIE1hcmsgdGhlIHNpZGViYXIgd2hpbGUgaXQgc2Nyb2xscywgc28gaXRzIHNjcm9sbGJhciByZXN0cyBpbnZpc2libGUuXG4gKlxuICogQSBzaXplZCBgOjotd2Via2l0LXNjcm9sbGJhcmAgb3B0cyB0aGUgZWxlbWVudCBvdXQgb2YgdGhlIHBsYXRmb3JtJ3NcbiAqIHNlbGYtaGlkaW5nIG92ZXJsYXkgYmFyLCBsZWF2aW5nIG9uZSBwYWludGVkIGF0IGFsbCB0aW1lczsgbm90aGluZyBpbiBDU1NcbiAqIHJlcG9ydHMgdGhhdCBhbiBlbGVtZW50IGlzIHNjcm9sbGluZy4gVGhlIGxpc3RlbmVyIGNhcHR1cmVzIGluc3RlYWQgb2ZcbiAqIGJ1YmJsaW5nIGJlY2F1c2Ugc2Nyb2xsIGV2ZW50cyBkbyBub3QgYnViYmxlLCBhbmQgbWFya3MgYSBgZGF0YS1gIGF0dHJpYnV0ZVxuICogcmF0aGVyIHRoYW4gYSBjbGFzcyBiZWNhdXNlIFZ1ZSByZXdyaXRlcyBgY2xhc3NgIHdob2xlc2FsZSB3aGVuIGl0IHBhdGNoZXNcbiAqIHRoZSBlbGVtZW50LlxuICovXG5jb25zdCBzY3JvbGxiYXJTY3JpcHQgPSBgXG4oKCkgPT4ge1xuICBsZXQgaWRsZVxuICBhZGRFdmVudExpc3RlbmVyKCdzY3JvbGwnLCAoZXZlbnQpID0+IHtcbiAgICBjb25zdCB0YXJnZXQgPSBldmVudC50YXJnZXRcbiAgICBpZiAoISh0YXJnZXQgaW5zdGFuY2VvZiBFbGVtZW50KSB8fCAhdGFyZ2V0LmNsYXNzTGlzdC5jb250YWlucygnVlBTaWRlYmFyJykpIHJldHVyblxuICAgIHRhcmdldC5kYXRhc2V0LnNjcm9sbGluZyA9ICcnXG4gICAgY2xlYXJUaW1lb3V0KGlkbGUpXG4gICAgaWRsZSA9IHNldFRpbWVvdXQoKCkgPT4gZGVsZXRlIHRhcmdldC5kYXRhc2V0LnNjcm9sbGluZywgODAwKVxuICB9LCB0cnVlKVxufSkoKVxuYFxuXG4vKipcbiAqIE5hdmlnYXRpb24tYmFyIHRpdGxlOiB0aGUgRGVlcFNlZWsgd29yZG1hcmsgYW5kIHRoZSByZWxlYXNlLXN0YWdlIHRhZy5cbiAqIFZpdGVQcmVzcyByZW5kZXJzIGBzaXRlVGl0bGVgIGFzIEhUTUwuXG4gKlxuICogQHBhcmFtIHByZXZpZXdUYWcgLSBMb2NhbGl6ZWQgcmVsZWFzZS1zdGFnZSBsYWJlbC5cbiAqIEByZXR1cm5zIE1hcmt1cCBwbGFjZWQgYmVzaWRlIHRoZSBuYXZpZ2F0aW9uLWJhciBob21lIGxpbmsuXG4gKi9cbmZ1bmN0aW9uIHNpdGVUaXRsZShwcmV2aWV3VGFnOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gYDxzcGFuIGNsYXNzPVwiZHNoLWxvY2t1cFwiPiR7d29yZG1hcmt9PHNwYW4gY2xhc3M9XCJkc2gtdGFnXCI+JHtwcmV2aWV3VGFnfTwvc3Bhbj48L3NwYW4+YFxufVxuXG5leHBvcnQgZGVmYXVsdCB3aXRoTWVybWFpZCh7XG4gIHRpdGxlOiBzaXRlSWRlbnRpdHkudGl0bGUsXG4gIGRlc2NyaXB0aW9uOiBzaXRlSWRlbnRpdHkuZGVzY3JpcHRpb24sXG4gIGJhc2UsXG4gIC8qKiBFbWl0IHRoZSByYXctTWFya2Rvd24gdHdpbiBvZiBldmVyeSByb3V0ZSBwbHVzIGxsbXMudHh0IGJlc2lkZSB0aGUgcmVuZGVyZWQgc2l0ZS4gKi9cbiAgYnVpbGRFbmQoc2l0ZUNvbmZpZzogU2l0ZUNvbmZpZykge1xuICAgIGVtaXRSYXdNYXJrZG93blBhZ2VzKHNpdGVDb25maWcub3V0RGlyKVxuICAgIHdyaXRlRmlsZVN5bmMocmVzb2x2ZShzaXRlQ29uZmlnLm91dERpciwgJ2xsbXMudHh0JyksIGxsbXNUeHQoeyBiYXNlLCAuLi5zaXRlSWRlbnRpdHkgfSkpXG4gIH0sXG4gIGhlYWQ6IFtcbiAgICAvLyBWaXRlUHJlc3MgbGVhdmVzIGhlYWQgaHJlZnMgdW50b3VjaGVkLCBzbyB0aGUgYmFzZSBiZWxvbmdzIGhlcmUgZXhwbGljaXRseS5cbiAgICBbJ2xpbmsnLCB7IHJlbDogJ2ljb24nLCB0eXBlOiAnaW1hZ2Uvc3ZnK3htbCcsIGhyZWY6IGAke2Jhc2V9ZmF2aWNvbi5zdmdgIH1dLFxuICAgIFsnc3R5bGUnLCB7fSwgc2l0ZVN0eWxlXSxcbiAgICBbJ3NjcmlwdCcsIHt9LCBzY3JvbGxiYXJTY3JpcHRdLFxuICBdLFxuICBjbGVhblVybHM6IHRydWUsXG4gIHNyY0RpcjogJy5nZW5lcmF0ZWQnLFxuICBjYWNoZURpcjogJy5jYWNoZScsXG4gIG91dERpcjogJy5kaXN0JyxcbiAgbG9jYWxlczoge1xuICAgIHJvb3Q6IHtcbiAgICAgIGxhYmVsOiAnXHU3QjgwXHU0RjUzXHU0RTJEXHU2NTg3JyxcbiAgICAgIGxhbmc6ICd6aC1DTicsXG4gICAgICB0aGVtZUNvbmZpZzoge1xuICAgICAgICBzaXRlVGl0bGU6IHNpdGVUaXRsZSgnXHU2MjgwXHU2NzJGXHU5ODg0XHU4OUM4JyksXG4gICAgICAgIG5hdjogW1xuICAgICAgICAgIHsgdGV4dDogJ1x1NTE2NVx1OTVFOCcsIGxpbms6IGxhbmRpbmdMaW5rKCdyb290JywgZ3VpZGVNb2R1bGVzLnJvb3QuZ3VpZGUpLCBhY3RpdmVNYXRjaDogJ14vZ3VpZGUvJyB9LFxuICAgICAgICAgIC4uLm1vZHVsZU5hdigncm9vdCcpLFxuICAgICAgICBdLFxuICAgICAgICBzaWRlYmFyOiB7XG4gICAgICAgICAgJy9ndWlkZS8nOiBndWlkZVNpZGViYXIoJ3Jvb3QnKSxcbiAgICAgICAgICAnL2RldmVsb3AvJzogc2lkZWJhcigncm9vdCcsICd6aC1kZXZlbG9wJyksXG4gICAgICAgICAgJy9yZWZlcmVuY2UvJzogc2lkZWJhcigncm9vdCcsICd6aC1yZWZlcmVuY2UnKSxcbiAgICAgICAgfSxcbiAgICAgICAgb3V0bGluZTogeyBsYWJlbDogJ1x1NjcyQ1x1OTg3NVx1NzZFRVx1NUY1NScgfSxcbiAgICAgICAgZG9jRm9vdGVyOiB7IHByZXY6ICdcdTRFMEFcdTRFMDBcdTdCQzcnLCBuZXh0OiAnXHU0RTBCXHU0RTAwXHU3QkM3JyB9LFxuICAgICAgICBkYXJrTW9kZVN3aXRjaExhYmVsOiAnXHU1OTE2XHU4OUMyJyxcbiAgICAgICAgbGlnaHRNb2RlU3dpdGNoVGl0bGU6ICdcdTUyMDdcdTYzNjJcdTUyMzBcdTZENDVcdTgyNzJcdTRFM0JcdTk4OTgnLFxuICAgICAgICBkYXJrTW9kZVN3aXRjaFRpdGxlOiAnXHU1MjA3XHU2MzYyXHU1MjMwXHU2REYxXHU4MjcyXHU0RTNCXHU5ODk4JyxcbiAgICAgICAgc2lkZWJhck1lbnVMYWJlbDogJ1x1ODNEQ1x1NTM1NScsXG4gICAgICAgIHJldHVyblRvVG9wTGFiZWw6ICdcdThGRDRcdTU2REVcdTk4NzZcdTkwRTgnLFxuICAgICAgICBsYW5nTWVudUxhYmVsOiAnXHU1MjA3XHU2MzYyXHU4QkVEXHU4QTAwJyxcbiAgICAgICAgc2tpcFRvQ29udGVudExhYmVsOiAnXHU4REYzXHU4MUYzXHU1MTg1XHU1QkI5JyxcbiAgICAgIH0sXG4gICAgfSxcbiAgICBlbjoge1xuICAgICAgbGFiZWw6ICdFbmdsaXNoJyxcbiAgICAgIGxhbmc6ICdlbi1VUycsXG4gICAgICBsaW5rOiAnL2VuLycsXG4gICAgICB0aGVtZUNvbmZpZzoge1xuICAgICAgICBzaXRlVGl0bGU6IHNpdGVUaXRsZSgnUHJldmlldycpLFxuICAgICAgICBuYXY6IFtcbiAgICAgICAgICB7IHRleHQ6ICdHdWlkZScsIGxpbms6IGxhbmRpbmdMaW5rKCdlbicsIGd1aWRlTW9kdWxlcy5lbi5ndWlkZSksIGFjdGl2ZU1hdGNoOiAnXi9lbi9ndWlkZS8nIH0sXG4gICAgICAgICAgLi4ubW9kdWxlTmF2KCdlbicpLFxuICAgICAgICBdLFxuICAgICAgICBzaWRlYmFyOiB7XG4gICAgICAgICAgJy9lbi9ndWlkZS8nOiBndWlkZVNpZGViYXIoJ2VuJyksXG4gICAgICAgICAgJy9lbi9kZXZlbG9wLyc6IHNpZGViYXIoJ2VuJywgJ2VuLWRldmVsb3AnKSxcbiAgICAgICAgICAnL2VuL3JlZmVyZW5jZS8nOiBzaWRlYmFyKCdlbicsICdlbi1yZWZlcmVuY2UnKSxcbiAgICAgICAgfSxcbiAgICAgICAgZWRpdExpbms6IHtcbiAgICAgICAgICBwYXR0ZXJuOiAoeyBmcm9udG1hdHRlciB9OiBQYWdlRGF0YSkgPT4ge1xuICAgICAgICAgICAgY29uc3QgZGF0YTogdW5rbm93biA9IGZyb250bWF0dGVyXG4gICAgICAgICAgICBjb25zdCBlZGl0U291cmNlOiB1bmtub3duID0gdHlwZW9mIGRhdGEgPT09ICdvYmplY3QnICYmIGRhdGEgIT09IG51bGwgPyBSZWZsZWN0LmdldChkYXRhLCAnZWRpdFNvdXJjZScpIDogdW5kZWZpbmVkXG4gICAgICAgICAgICBpZiAodHlwZW9mIGVkaXRTb3VyY2UgIT09ICdzdHJpbmcnKSB0aHJvdyBuZXcgRXJyb3IoJ1Byb2plY3RlZCBkb2N1bWVudGF0aW9uIHBhZ2UgaGFzIG5vIGVkaXRTb3VyY2UgZnJvbnRtYXR0ZXIuJylcbiAgICAgICAgICAgIHJldHVybiBgaHR0cHM6Ly9naXRodWIuY29tL2RlZXBzZWVrLWFpL2RlZXBzZWVrLWhhcm5lc3MvZWRpdC9tYXN0ZXIvJHtlZGl0U291cmNlfWBcbiAgICAgICAgICB9LFxuICAgICAgICAgIHRleHQ6ICdFZGl0IHRoaXMgcGFnZSBvbiBHaXRIdWInLFxuICAgICAgICB9LFxuICAgICAgICBvdXRsaW5lOiB7IGxhYmVsOiAnT24gdGhpcyBwYWdlJyB9LFxuICAgICAgICBkb2NGb290ZXI6IHsgcHJldjogJ1ByZXZpb3VzJywgbmV4dDogJ05leHQnIH0sXG4gICAgICB9LFxuICAgIH0sXG4gIH0sXG4gIHZpdGU6IHtcbiAgICAvLyBgc3JjRGlyYCBwdXRzIHRoZSBWaXRlIHJvb3QgaW5zaWRlIHRoZSBkaXNwb3NhYmxlIGdlbmVyYXRlZCB0cmVlLCB3aG9zZVxuICAgIC8vIG93biBgcHVibGljL2Agbm8gdHJhY2tlZCBhc3NldCBjYW4gbGl2ZSBpbi5cbiAgICBwdWJsaWNEaXI6IHJlc29sdmUoaW1wb3J0Lm1ldGEuZGlybmFtZSwgJy4uL3B1YmxpYycpLFxuICAgIHBsdWdpbnM6IFtcbiAgICAgIHtcbiAgICAgICAgbmFtZTogJ2RlZXBzZWVrLWhhcm5lc3MtZG9jLXByb2plY3RvcicsXG4gICAgICAgIGNvbmZpZ3VyZVNlcnZlcihzZXJ2ZXIpIHtcbiAgICAgICAgICB3YXRjaENhbm9uaWNhbERvY3Moc2VydmVyKVxuICAgICAgICAgIHNlcnZlUmF3TWFya2Rvd24oc2VydmVyKVxuICAgICAgICB9LFxuICAgICAgfSxcbiAgICBdLFxuICB9LFxuICBtYXJrZG93bjoge1xuICAgIGNvbmZpZyhtZCkge1xuICAgICAgY29uc3QgcmVuZGVyVGV4dCA9IG1kLnJlbmRlcmVyLnJ1bGVzLnRleHRcbiAgICAgIGNvbnN0IHJlbmRlckNvZGUgPSBtZC5yZW5kZXJlci5ydWxlcy5jb2RlX2lubGluZVxuICAgICAgY29uc3QgcmVuZGVyRmVuY2UgPSBtZC5yZW5kZXJlci5ydWxlcy5mZW5jZVxuICAgICAgaWYgKHJlbmRlclRleHQgPT09IHVuZGVmaW5lZCkgdGhyb3cgbmV3IEVycm9yKCdWaXRlUHJlc3MgTWFya2Rvd24gcmVuZGVyZXIgaXMgbWlzc2luZyB0aGUgdGV4dCByZW5kZXJpbmcgcnVsZS4nKVxuICAgICAgaWYgKHJlbmRlckNvZGUgPT09IHVuZGVmaW5lZCkgdGhyb3cgbmV3IEVycm9yKCdWaXRlUHJlc3MgTWFya2Rvd24gcmVuZGVyZXIgaXMgbWlzc2luZyB0aGUgaW5saW5lLWNvZGUgcmVuZGVyaW5nIHJ1bGUuJylcbiAgICAgIGlmIChyZW5kZXJGZW5jZSA9PT0gdW5kZWZpbmVkKSB0aHJvdyBuZXcgRXJyb3IoJ1ZpdGVQcmVzcyBNYXJrZG93biByZW5kZXJlciBpcyBtaXNzaW5nIHRoZSBmZW5jZSByZW5kZXJpbmcgcnVsZS4nKVxuICAgICAgbWQucmVuZGVyZXIucnVsZXMudGV4dCA9ICguLi5hcmdzKSA9PiBlc2NhcGVWdWVJbnRlcnBvbGF0aW9uKHJlbmRlclRleHQoLi4uYXJncykpXG4gICAgICBtZC5yZW5kZXJlci5ydWxlcy5jb2RlX2lubGluZSA9ICguLi5hcmdzKSA9PiBlc2NhcGVWdWVJbnRlcnBvbGF0aW9uKHJlbmRlckNvZGUoLi4uYXJncykpXG4gICAgICBjb25zdCByZW5kZXJlZEZlbmNlcyA9IG5ldyBNYXA8c3RyaW5nLCBzdHJpbmc+KClcbiAgICAgIG1kLnJlbmRlcmVyLnJ1bGVzLmZlbmNlID0gKC4uLmFyZ3MpID0+IHtcbiAgICAgICAgY29uc3QgW3Rva2VucywgaW5kZXhdID0gYXJnc1xuICAgICAgICBjb25zdCB0b2tlbiA9IHRva2Vuc1tpbmRleF1cbiAgICAgICAgaWYgKHRva2VuID09PSB1bmRlZmluZWQpIHRocm93IG5ldyBFcnJvcignVml0ZVByZXNzIGNvZGUtZmVuY2UgcmVuZGVyZXIgcmVjZWl2ZWQgbm8gdG9rZW4uJylcbiAgICAgICAgLy8gTWVybWFpZCBvdXRwdXQgZW1iZWRzIHRoZSB0b2tlbiBwb3NpdGlvbiwgYW5kIFZpdGVQcmVzcyBzbmlwcGV0cyByZXNvbHZlIHNvdXJjZSBmaWxlcyBkdXJpbmcgcmVuZGVyaW5nLlxuICAgICAgICBpZiAoWydtZXJtYWlkJywgJ21tZCddLmluY2x1ZGVzKHRva2VuLmluZm8udHJpbSgpLnNwbGl0KC9cXHMrLywgMSlbMF0gPz8gJycpKSByZXR1cm4gcmVuZGVyRmVuY2UoLi4uYXJncylcbiAgICAgICAgaWYgKFJlZmxlY3QuZ2V0KHRva2VuLCAnc3JjJykgIT09IHVuZGVmaW5lZCkgcmV0dXJuIHJlbmRlckZlbmNlKC4uLmFyZ3MpXG4gICAgICAgIC8vIEtlZXAgdGhlIGNhY2hlIGJ1aWxkLWxvY2FsOyBhIGRldiByZW5kZXJlciBjYW4gc3Vydml2ZSBtYW55IEhNUiB1cGRhdGVzLlxuICAgICAgICBpZiAocHJvY2Vzcy5lbnYuTk9ERV9FTlYgIT09ICdwcm9kdWN0aW9uJykgcmV0dXJuIHJlbmRlckZlbmNlKC4uLmFyZ3MpXG4gICAgICAgIGNvbnN0IGtleSA9IEpTT04uc3RyaW5naWZ5KFt0b2tlbi5jb250ZW50LCB0b2tlbi5pbmZvLCB0b2tlbi5tYXJrdXAsIHRva2VuLmF0dHJzXSlcbiAgICAgICAgY29uc3QgY2FjaGVkID0gcmVuZGVyZWRGZW5jZXMuZ2V0KGtleSlcbiAgICAgICAgaWYgKGNhY2hlZCAhPT0gdW5kZWZpbmVkKSByZXR1cm4gY2FjaGVkXG4gICAgICAgIGNvbnN0IGh0bWwgPSByZW5kZXJGZW5jZSguLi5hcmdzKVxuICAgICAgICByZW5kZXJlZEZlbmNlcy5zZXQoa2V5LCBodG1sKVxuICAgICAgICByZXR1cm4gaHRtbFxuICAgICAgfVxuICAgIH0sXG4gIH0sXG4gIG1lcm1haWQ6IHt9LFxuICB0aGVtZUNvbmZpZzogc2hhcmVkVGhlbWUsXG59KVxuIiwgImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCJFOlxcXFxNaXhcXFxccHJvamVjdFxcXFxkZWVwc2Vlay1oYXJuZXNzXFxcXC53b3JrdHJlZXNcXFxcdXBzdHJlYW0tZmlyc3RcXFxcd2Vic2l0ZVwiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9maWxlbmFtZSA9IFwiRTpcXFxcTWl4XFxcXHByb2plY3RcXFxcZGVlcHNlZWstaGFybmVzc1xcXFwud29ya3RyZWVzXFxcXHVwc3RyZWFtLWZpcnN0XFxcXHdlYnNpdGVcXFxcZG9jcy50c1wiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9pbXBvcnRfbWV0YV91cmwgPSBcImZpbGU6Ly8vRTovTWl4L3Byb2plY3QvZGVlcHNlZWstaGFybmVzcy8ud29ya3RyZWVzL3Vwc3RyZWFtLWZpcnN0L3dlYnNpdGUvZG9jcy50c1wiOy8qKlxuICogQ2Fub25pY2FsIHB1YmxpY2F0aW9uIG1hbmlmZXN0IGZvciB0aGUgZG9jdW1lbnRhdGlvbiB3ZWJzaXRlLlxuICpcbiAqIE1hcmtkb3duIHN0YXlzIGluIGl0cyBvd25pbmcgcmVwb3NpdG9yeSB0aWVyLiBUaGlzIG1hbmlmZXN0IG1hcHMgZWFjaFxuICogY2Fub25pY2FsIHNvdXJjZSBpbnRvIG1hdGNoaW5nIHJvdXRlIHRyZWVzIGZvciBib3RoIHNpdGUgbG9jYWxlczsgd2hlbiBhXG4gKiB0cmFuc2xhdGlvbiBpcyBhYnNlbnQsIGJvdGggcm91dGVzIGludGVudGlvbmFsbHkgcHJvamVjdCB0aGUgYXZhaWxhYmxlXG4gKiBzb3VyY2UgaW5zdGVhZCBvZiBjb3B5aW5nIE1hcmtkb3duLlxuICovXG5cbi8qKiBMb2NhbGUga2V5IHVzZWQgYnkgdGhlIFZpdGVQcmVzcyBzaXRlLiAqL1xuZXhwb3J0IHR5cGUgRG9jc0xvY2FsZSA9ICdyb290JyB8ICdlbidcblxuLyoqIFNpZGViYXIgY29sbGVjdGlvbiByZW5kZXJlZCBmb3Igb25lIGxvY2FsZSBhbmQgdG9wLWxldmVsIG1vZHVsZS4gKi9cbmV4cG9ydCB0eXBlIERvY3NTaWRlYmFyID1cbiAgfCAnemgtZ3VpZGUnXG4gIHwgJ3poLWRldmVsb3AnXG4gIHwgJ3poLXJlZmVyZW5jZSdcbiAgfCAnZW4tZ3VpZGUnXG4gIHwgJ2VuLWRldmVsb3AnXG4gIHwgJ2VuLXJlZmVyZW5jZSdcblxuLyoqIEEgcGFnZSBwcm9qZWN0ZWQgaW50byB0aGUgVml0ZVByZXNzIHNvdXJjZSB0cmVlLiAqL1xuZXhwb3J0IGludGVyZmFjZSBEb2NzUGFnZSB7XG4gIC8qKiBWaXRlUHJlc3MgbG9jYWxlIHdob3NlIHJvdXRlIHRyZWUgb3ducyB0aGlzIHByb2plY3Rpb24uICovXG4gIGxvY2FsZTogRG9jc0xvY2FsZVxuICAvKiogTGFuZ3VhZ2Ugb2YgdGhlIGNhbm9uaWNhbCBzb3VyY2UgY3VycmVudGx5IHByb2plY3RlZCBhdCB0aGlzIHJvdXRlLiAqL1xuICBjb250ZW50TG9jYWxlOiAnemgtQ04nIHwgJ2VuLVVTJ1xuICAvKiogUmVwb3NpdG9yeS1yZWxhdGl2ZSBjYW5vbmljYWwgTWFya2Rvd24gc291cmNlLiAqL1xuICBzb3VyY2U6IHN0cmluZ1xuICAvKiogVml0ZVByZXNzIHJvdXRlLCBpbmNsdWRpbmcgdGhlIGAubWRgIHN1ZmZpeC4gKi9cbiAgcm91dGU6IHN0cmluZ1xuICAvKiogTmF2aWdhdGlvbiBsYWJlbCBzaG93biBpbiB0aGUgc2lkZWJhci4gKi9cbiAgbGFiZWw6IHN0cmluZ1xuICAvKiogU2lkZWJhciBjb2xsZWN0aW9uIHRoYXQgb3ducyB0aGUgcGFnZSwgb3IgbnVsbCBmb3IgYSBsb2NhbGUgaG9tZSBwYWdlLiAqL1xuICBzaWRlYmFyOiBEb2NzU2lkZWJhciB8IG51bGxcbiAgLyoqIFNlY3Rpb24gbGFiZWwgd2l0aGluIHRoZSBzaWRlYmFyLiAqL1xuICBzZWN0aW9uOiBzdHJpbmdcbiAgLyoqIFN0YWJsZSBvcmRlciB3aXRoaW4gdGhlIHNlY3Rpb24uICovXG4gIG9yZGVyOiBudW1iZXJcbiAgLyoqIEhlYWRpbmcgbGV2ZWxzIGluY2x1ZGVkIGluIHRoaXMgcGFnZSdzIFZpdGVQcmVzcyBvdXRsaW5lLiAqL1xuICBvdXRsaW5lPzogbnVtYmVyIHwgcmVhZG9ubHkgW251bWJlciwgbnVtYmVyXSB8ICdkZWVwJyB8IGZhbHNlXG4gIC8qKiBBZGRpdGlvbmFsIHJlcG9zaXRvcnkgcGF0aHMgdGhhdCByZXNvbHZlIHRvIHRoaXMgcGFnZS4gKi9cbiAgc291cmNlQWxpYXNlcz86IHN0cmluZ1tdXG59XG5cbmludGVyZmFjZSBNaXJyb3JlZFBhZ2Uge1xuICBzb3VyY2U6IHN0cmluZyB8IFJlY29yZDxEb2NzTG9jYWxlLCBzdHJpbmc+XG4gIHJvdXRlOiBzdHJpbmdcbiAgY29udGVudExvY2FsZTogRG9jc1BhZ2VbJ2NvbnRlbnRMb2NhbGUnXSB8IFJlY29yZDxEb2NzTG9jYWxlLCBEb2NzUGFnZVsnY29udGVudExvY2FsZSddPlxuICBsYWJlbDogUmVjb3JkPERvY3NMb2NhbGUsIHN0cmluZz5cbiAgc2lkZWJhcjogUmVjb3JkPERvY3NMb2NhbGUsIERvY3NTaWRlYmFyIHwgbnVsbD5cbiAgc2VjdGlvbjogUmVjb3JkPERvY3NMb2NhbGUsIHN0cmluZz5cbiAgb3JkZXI6IG51bWJlclxuICBvdXRsaW5lPzogRG9jc1BhZ2VbJ291dGxpbmUnXVxuICBzb3VyY2VBbGlhc2VzPzogc3RyaW5nW10gfCBQYXJ0aWFsPFJlY29yZDxEb2NzTG9jYWxlLCBzdHJpbmdbXT4+XG59XG5cbnR5cGUgUGFpcmVkUGFnZSA9IE9taXQ8TWlycm9yZWRQYWdlLCAnc291cmNlJyB8ICdjb250ZW50TG9jYWxlJyB8ICdzb3VyY2VBbGlhc2VzJz4gJiB7XG4gIC8qKiBFbmdsaXNoIHNpZGUgb2YgYSBzaWJsaW5nIGBmb28ubWRgIC8gYGZvby56aC5tZGAgcGFpci4gKi9cbiAgc291cmNlOiBzdHJpbmdcbiAgLyoqIExhbmd1YWdlLW5ldXRyYWwgcmVwb3NpdG9yeSBhbGlhc2VzLCBzdWNoIGFzIHRoZSBkaXJlY3Rvcnkgb2YgYW4gaW5kZXggcGFnZS4gKi9cbiAgc291cmNlQWxpYXNlcz86IHN0cmluZ1tdXG59XG5cbmZ1bmN0aW9uIGxvY2FsaXplZDxUPih2YWx1ZTogVCB8IFJlY29yZDxEb2NzTG9jYWxlLCBUPiwgbG9jYWxlOiBEb2NzTG9jYWxlKTogVCB7XG4gIHJldHVybiB0eXBlb2YgdmFsdWUgPT09ICdvYmplY3QnICYmIHZhbHVlICE9PSBudWxsICYmICFBcnJheS5pc0FycmF5KHZhbHVlKVxuICAgID8gKHZhbHVlIGFzIFJlY29yZDxEb2NzTG9jYWxlLCBUPilbbG9jYWxlXVxuICAgIDogdmFsdWVcbn1cblxuZnVuY3Rpb24gbWlycm9yZWRQYWdlcyhwYWdlczogTWlycm9yZWRQYWdlW10pOiBEb2NzUGFnZVtdIHtcbiAgcmV0dXJuIHBhZ2VzLmZsYXRNYXAocGFnZSA9PiAoWydyb290JywgJ2VuJ10gYXMgY29uc3QpLm1hcCgobG9jYWxlKSA9PiB7XG4gICAgY29uc3QgYWxpYXNlcyA9IHBhZ2Uuc291cmNlQWxpYXNlcyA9PT0gdW5kZWZpbmVkXG4gICAgICA/IHVuZGVmaW5lZFxuICAgICAgOiBBcnJheS5pc0FycmF5KHBhZ2Uuc291cmNlQWxpYXNlcykgPyBwYWdlLnNvdXJjZUFsaWFzZXMgOiBwYWdlLnNvdXJjZUFsaWFzZXNbbG9jYWxlXVxuICAgIHJldHVybiB7XG4gICAgICBsb2NhbGUsXG4gICAgICBjb250ZW50TG9jYWxlOiBsb2NhbGl6ZWQocGFnZS5jb250ZW50TG9jYWxlLCBsb2NhbGUpLFxuICAgICAgc291cmNlOiBsb2NhbGl6ZWQocGFnZS5zb3VyY2UsIGxvY2FsZSksXG4gICAgICByb3V0ZTogbG9jYWxlID09PSAncm9vdCcgPyBwYWdlLnJvdXRlIDogYGVuLyR7cGFnZS5yb3V0ZX1gLFxuICAgICAgbGFiZWw6IHBhZ2UubGFiZWxbbG9jYWxlXSxcbiAgICAgIHNpZGViYXI6IHBhZ2Uuc2lkZWJhcltsb2NhbGVdLFxuICAgICAgc2VjdGlvbjogcGFnZS5zZWN0aW9uW2xvY2FsZV0sXG4gICAgICBvcmRlcjogcGFnZS5vcmRlcixcbiAgICAgIC4uLihwYWdlLm91dGxpbmUgPT09IHVuZGVmaW5lZCA/IHt9IDogeyBvdXRsaW5lOiBwYWdlLm91dGxpbmUgfSksXG4gICAgICAuLi4oYWxpYXNlcyA9PT0gdW5kZWZpbmVkID8ge30gOiB7IHNvdXJjZUFsaWFzZXM6IGFsaWFzZXMgfSksXG4gICAgfVxuICB9KSlcbn1cblxuZnVuY3Rpb24gcGFpcmVkUGFnZXMocGFnZXM6IFBhaXJlZFBhZ2VbXSk6IERvY3NQYWdlW10ge1xuICByZXR1cm4gbWlycm9yZWRQYWdlcyhwYWdlcy5tYXAoKHBhZ2UpID0+IHtcbiAgICBjb25zdCBjaGluZXNlU291cmNlID0gcGFnZS5zb3VyY2UucmVwbGFjZSgvXFwubWQkLywgJy56aC5tZCcpXG4gICAgY29uc3Qgc2hhcmVkQWxpYXNlcyA9IHBhZ2Uuc291cmNlQWxpYXNlcyA/PyBbXVxuICAgIHJldHVybiB7XG4gICAgICAuLi5wYWdlLFxuICAgICAgc291cmNlOiB7IHJvb3Q6IGNoaW5lc2VTb3VyY2UsIGVuOiBwYWdlLnNvdXJjZSB9LFxuICAgICAgY29udGVudExvY2FsZTogeyByb290OiAnemgtQ04nLCBlbjogJ2VuLVVTJyB9LFxuICAgICAgc291cmNlQWxpYXNlczoge1xuICAgICAgICByb290OiBbLi4uc2hhcmVkQWxpYXNlcywgcGFnZS5zb3VyY2VdLFxuICAgICAgICBlbjogWy4uLnNoYXJlZEFsaWFzZXMsIGNoaW5lc2VTb3VyY2VdLFxuICAgICAgfSxcbiAgICB9XG4gIH0pKVxufVxuXG5jb25zdCBob21lQW5kR3VpZGUgPSBwYWlyZWRQYWdlcyhbXG4gIHtcbiAgICBzb3VyY2U6ICdkb2NzL3VzZXIvaW5kZXgubWQnLFxuICAgIHJvdXRlOiAnaW5kZXgubWQnLFxuICAgIGxhYmVsOiB7IHJvb3Q6ICdEZWVwU2VlayBIYXJuZXNzJywgZW46ICdEZWVwU2VlayBIYXJuZXNzJyB9LFxuICAgIHNpZGViYXI6IHsgcm9vdDogbnVsbCwgZW46IG51bGwgfSxcbiAgICBzZWN0aW9uOiB7IHJvb3Q6ICdcdTk5OTZcdTk4NzUnLCBlbjogJ0hvbWUnIH0sXG4gICAgb3JkZXI6IDAsXG4gIH0sXG4gIHtcbiAgICBzb3VyY2U6ICdkb2NzL3VzZXIvZ3VpZGUvaW5kZXgubWQnLFxuICAgIHJvdXRlOiAnZ3VpZGUvcXVpY2tzdGFydC5tZCcsXG4gICAgbGFiZWw6IHsgcm9vdDogJ1x1NEY3Rlx1NzUyOCBXZWIgVUknLCBlbjogJ1VzZSB0aGUgV2ViIFVJJyB9LFxuICAgIHNpZGViYXI6IHsgcm9vdDogJ3poLWd1aWRlJywgZW46ICdlbi1ndWlkZScgfSxcbiAgICBzZWN0aW9uOiB7IHJvb3Q6ICdcdTUxNjVcdTk1RTgnLCBlbjogJ0d1aWRlJyB9LFxuICAgIG9yZGVyOiAxLFxuICAgIHNvdXJjZUFsaWFzZXM6IFsnZG9jcy91c2VyL2d1aWRlJ10sXG4gIH0sXG4gIHtcbiAgICBzb3VyY2U6ICdkb2NzL3VzZXIvZ3VpZGUvcHJvdmlkZXJzLm1kJyxcbiAgICByb3V0ZTogJ2d1aWRlL3Byb3ZpZGVycy5tZCcsXG4gICAgbGFiZWw6IHsgcm9vdDogJ1x1OTE0RFx1N0Y2RVx1NkEyMVx1NTc4QicsIGVuOiAnQ29uZmlndXJlIG1vZGVscycgfSxcbiAgICBzaWRlYmFyOiB7IHJvb3Q6ICd6aC1ndWlkZScsIGVuOiAnZW4tZ3VpZGUnIH0sXG4gICAgc2VjdGlvbjogeyByb290OiAnXHU1MTY1XHU5NUU4JywgZW46ICdHdWlkZScgfSxcbiAgICBvcmRlcjogMixcbiAgfSxcbiAge1xuICAgIHNvdXJjZTogJ2RvY3MvdXNlci9ndWlkZS9uZXR3b3JrLXByb3h5Lm1kJyxcbiAgICByb3V0ZTogJ2d1aWRlL25ldHdvcmstcHJveHkubWQnLFxuICAgIGxhYmVsOiB7IHJvb3Q6ICdcdTdGNTFcdTdFRENcdTRFRTNcdTc0MDYnLCBlbjogJ05ldHdvcmsgcHJveHknIH0sXG4gICAgc2lkZWJhcjogeyByb290OiAnemgtZ3VpZGUnLCBlbjogJ2VuLWd1aWRlJyB9LFxuICAgIHNlY3Rpb246IHsgcm9vdDogJ1x1NTE2NVx1OTVFOCcsIGVuOiAnR3VpZGUnIH0sXG4gICAgb3JkZXI6IDMsXG4gIH0sXG4gIHtcbiAgICBzb3VyY2U6ICdkb2NzL3VzZXIvZ3VpZGUvcHl0aG9uLXNkay5tZCcsXG4gICAgcm91dGU6ICdndWlkZS9weXRob24tc2RrLm1kJyxcbiAgICBsYWJlbDogeyByb290OiAnUHl0aG9uJywgZW46ICdQeXRob24nIH0sXG4gICAgc2lkZWJhcjogeyByb290OiAnemgtZ3VpZGUnLCBlbjogJ2VuLWd1aWRlJyB9LFxuICAgIHNlY3Rpb246IHsgcm9vdDogJ1NESycsIGVuOiAnU0RLJyB9LFxuICAgIG9yZGVyOiAxLFxuICB9LFxuICB7XG4gICAgc291cmNlOiAnZG9jcy91c2VyL2d1aWRlL2dpdGh1Yi1yZXZpZXcubWQnLFxuICAgIHJvdXRlOiAnZ3VpZGUvZ2l0aHViLXJldmlldy5tZCcsXG4gICAgbGFiZWw6IHsgcm9vdDogJ0dpdEh1YiBcdThCQzRcdTVCQTFcdTRGMUFcdThCREQnLCBlbjogJ0dpdEh1YiByZXZpZXcgc2Vzc2lvbnMnIH0sXG4gICAgc2lkZWJhcjogeyByb290OiAnemgtZ3VpZGUnLCBlbjogJ2VuLWd1aWRlJyB9LFxuICAgIHNlY3Rpb246IHsgcm9vdDogJ1x1ODFFQVx1NTJBOFx1NTMxNicsIGVuOiAnQXV0b21hdGlvbicgfSxcbiAgICBvcmRlcjogMSxcbiAgfSxcbiAge1xuICAgIHNvdXJjZTogJ2RvY3MvdXNlci9ndWlkZS9zY2hlZHVsZS5tZCcsXG4gICAgcm91dGU6ICdndWlkZS9zY2hlZHVsZS5tZCcsXG4gICAgbGFiZWw6IHsgcm9vdDogJ1x1NEYxQVx1OEJERFx1NTE4NVx1NjNEMFx1OTE5MicsIGVuOiAnU2Vzc2lvbiByZW1pbmRlcnMnIH0sXG4gICAgc2lkZWJhcjogeyByb290OiAnemgtZ3VpZGUnLCBlbjogJ2VuLWd1aWRlJyB9LFxuICAgIHNlY3Rpb246IHsgcm9vdDogJ1x1ODFFQVx1NTJBOFx1NTMxNicsIGVuOiAnQXV0b21hdGlvbicgfSxcbiAgICBvcmRlcjogMixcbiAgfSxcbiAge1xuICAgIHNvdXJjZTogJ2RvY3MvdXNlci9ndWlkZS9tY3AtbWVtb3J5Lm1kJyxcbiAgICByb3V0ZTogJ2d1aWRlL21jcC1tZW1vcnkubWQnLFxuICAgIGxhYmVsOiB7IHJvb3Q6ICdcdThCQjBcdTVGQzYgTUNQJywgZW46ICdNZW1vcnkgTUNQJyB9LFxuICAgIHNpZGViYXI6IHsgcm9vdDogJ3poLWd1aWRlJywgZW46ICdlbi1ndWlkZScgfSxcbiAgICBzZWN0aW9uOiB7IHJvb3Q6ICdcdTk2QzZcdTYyMTAnLCBlbjogJ0ludGVncmF0aW9ucycgfSxcbiAgICBvcmRlcjogMSxcbiAgfSxcbl0pXG5cbmNvbnN0IGRldmVsb3AgPSBwYWlyZWRQYWdlcyhbXG4gIHtcbiAgICBzb3VyY2U6ICdkb2NzL3VzZXIvZGV2ZWxvcC9iYXNpYy9pbmRleC5tZCcsXG4gICAgcm91dGU6ICdkZXZlbG9wL2Jhc2ljL2luZGV4Lm1kJyxcbiAgICBsYWJlbDogeyByb290OiAnXHU3QjJDXHU0RTAwXHU0RTJBIEhhcm5lc3MgXHU2M0QyXHU0RUY2JywgZW46ICdZb3VyIGZpcnN0IEhhcm5lc3MgcGx1Z2luJyB9LFxuICAgIHNpZGViYXI6IHsgcm9vdDogJ3poLWRldmVsb3AnLCBlbjogJ2VuLWRldmVsb3AnIH0sXG4gICAgc2VjdGlvbjogeyByb290OiAnXHU1N0ZBXHU3ODQwJywgZW46ICdCYXNpY3MnIH0sXG4gICAgb3JkZXI6IDEsXG4gICAgc291cmNlQWxpYXNlczogWydkb2NzL3VzZXIvZGV2ZWxvcC9iYXNpYyddLFxuICB9LFxuICB7XG4gICAgc291cmNlOiAnZG9jcy91c2VyL2RldmVsb3AvYmFzaWMvdG9vbC5tZCcsXG4gICAgcm91dGU6ICdkZXZlbG9wL2Jhc2ljL3Rvb2wubWQnLFxuICAgIGxhYmVsOiB7IHJvb3Q6ICdcdTVGMDBcdTUzRDFcdTRFMDBcdTRFMkEgVG9vbCcsIGVuOiAnQnVpbGQgYSB0b29sJyB9LFxuICAgIHNpZGViYXI6IHsgcm9vdDogJ3poLWRldmVsb3AnLCBlbjogJ2VuLWRldmVsb3AnIH0sXG4gICAgc2VjdGlvbjogeyByb290OiAnXHU1N0ZBXHU3ODQwJywgZW46ICdCYXNpY3MnIH0sXG4gICAgb3JkZXI6IDIsXG4gIH0sXG4gIHtcbiAgICBzb3VyY2U6ICdkb2NzL3VzZXIvZGV2ZWxvcC9iYXNpYy9jb25maWcubWQnLFxuICAgIHJvdXRlOiAnZGV2ZWxvcC9iYXNpYy9jb25maWcubWQnLFxuICAgIGxhYmVsOiB7IHJvb3Q6ICdcdTYzRDJcdTRFRjZcdTkxNERcdTdGNkUnLCBlbjogJ1BsdWdpbiBjb25maWd1cmF0aW9uJyB9LFxuICAgIHNpZGViYXI6IHsgcm9vdDogJ3poLWRldmVsb3AnLCBlbjogJ2VuLWRldmVsb3AnIH0sXG4gICAgc2VjdGlvbjogeyByb290OiAnXHU1N0ZBXHU3ODQwJywgZW46ICdCYXNpY3MnIH0sXG4gICAgb3JkZXI6IDMsXG4gIH0sXG4gIHtcbiAgICBzb3VyY2U6ICdkb2NzL3VzZXIvZGV2ZWxvcC9iYXNpYy9wdWJsaXNoLm1kJyxcbiAgICByb3V0ZTogJ2RldmVsb3AvYmFzaWMvcHVibGlzaC5tZCcsXG4gICAgbGFiZWw6IHsgcm9vdDogJ1x1NjI1M1x1NTMwNVx1NEUwRVx1NUI4OVx1ODhDNVx1NjNEMlx1NEVGNicsIGVuOiAnUGFja2FnZSBhbmQgaW5zdGFsbCcgfSxcbiAgICBzaWRlYmFyOiB7IHJvb3Q6ICd6aC1kZXZlbG9wJywgZW46ICdlbi1kZXZlbG9wJyB9LFxuICAgIHNlY3Rpb246IHsgcm9vdDogJ1x1NTdGQVx1Nzg0MCcsIGVuOiAnQmFzaWNzJyB9LFxuICAgIG9yZGVyOiA0LFxuICB9LFxuICB7XG4gICAgc291cmNlOiAnZG9jcy91c2VyL2RldmVsb3AvZnJhbWV3b3JrL2luZGV4Lm1kJyxcbiAgICByb3V0ZTogJ2RldmVsb3AvZnJhbWV3b3JrL2luZGV4Lm1kJyxcbiAgICBsYWJlbDogeyByb290OiAnXHU2M0QyXHU0RUY2XHU0RTBFXHU3NTFGXHU1NDdEXHU1NDY4XHU2NzFGJywgZW46ICdQbHVnaW4gbGlmZWN5Y2xlJyB9LFxuICAgIHNpZGViYXI6IHsgcm9vdDogJ3poLWRldmVsb3AnLCBlbjogJ2VuLWRldmVsb3AnIH0sXG4gICAgc2VjdGlvbjogeyByb290OiAnXHU2ODQ2XHU2N0I2XHU4MEZEXHU1MjlCJywgZW46ICdGcmFtZXdvcmsnIH0sXG4gICAgb3JkZXI6IDEsXG4gICAgc291cmNlQWxpYXNlczogWydkb2NzL3VzZXIvZGV2ZWxvcC9mcmFtZXdvcmsnXSxcbiAgfSxcbiAge1xuICAgIHNvdXJjZTogJ2RvY3MvdXNlci9kZXZlbG9wL2ZyYW1ld29yay9zZXJ2aWNlLm1kJyxcbiAgICByb3V0ZTogJ2RldmVsb3AvZnJhbWV3b3JrL3NlcnZpY2UubWQnLFxuICAgIGxhYmVsOiB7IHJvb3Q6ICdcdTY3MERcdTUyQTFcdTRFMEVcdTRGOURcdThENTYnLCBlbjogJ1NlcnZpY2VzIGFuZCBkZXBlbmRlbmNpZXMnIH0sXG4gICAgc2lkZWJhcjogeyByb290OiAnemgtZGV2ZWxvcCcsIGVuOiAnZW4tZGV2ZWxvcCcgfSxcbiAgICBzZWN0aW9uOiB7IHJvb3Q6ICdcdTY4NDZcdTY3QjZcdTgwRkRcdTUyOUInLCBlbjogJ0ZyYW1ld29yaycgfSxcbiAgICBvcmRlcjogMixcbiAgfSxcbiAge1xuICAgIHNvdXJjZTogJ2RvY3MvdXNlci9kZXZlbG9wL2ZyYW1ld29yay9ldmVudHMubWQnLFxuICAgIHJvdXRlOiAnZGV2ZWxvcC9mcmFtZXdvcmsvZXZlbnRzLm1kJyxcbiAgICBsYWJlbDogeyByb290OiAnXHU0RThCXHU0RUY2XHU3Q0ZCXHU3RURGJywgZW46ICdFdmVudCBzeXN0ZW0nIH0sXG4gICAgc2lkZWJhcjogeyByb290OiAnemgtZGV2ZWxvcCcsIGVuOiAnZW4tZGV2ZWxvcCcgfSxcbiAgICBzZWN0aW9uOiB7IHJvb3Q6ICdcdTY4NDZcdTY3QjZcdTgwRkRcdTUyOUInLCBlbjogJ0ZyYW1ld29yaycgfSxcbiAgICBvcmRlcjogMyxcbiAgfSxcbiAge1xuICAgIHNvdXJjZTogJ2RvY3MvdXNlci9kZXZlbG9wL3ByYWN0aWNlL2luZGV4Lm1kJyxcbiAgICByb3V0ZTogJ2RldmVsb3AvcHJhY3RpY2UvaW5kZXgubWQnLFxuICAgIGxhYmVsOiB7IHJvb3Q6ICdcdTgwRkRcdTUyOUJcdTc2ODRcdTRFMDlcdTVDNDJcdTYyQzZcdTUyMDYnLCBlbjogJ0NhcGFiaWxpdHkgbGF5ZXJpbmcnIH0sXG4gICAgc2lkZWJhcjogeyByb290OiAnemgtZGV2ZWxvcCcsIGVuOiAnZW4tZGV2ZWxvcCcgfSxcbiAgICBzZWN0aW9uOiB7IHJvb3Q6ICdcdTVCOUVcdTYyMTgnLCBlbjogJ1ByYWN0aWNlJyB9LFxuICAgIG9yZGVyOiAxLFxuICAgIHNvdXJjZUFsaWFzZXM6IFsnZG9jcy91c2VyL2RldmVsb3AvcHJhY3RpY2UnXSxcbiAgfSxcbiAge1xuICAgIHNvdXJjZTogJ2RvY3MvdXNlci9kZXZlbG9wL3ByYWN0aWNlL2xsbS1hZGFwdGVyLm1kJyxcbiAgICByb3V0ZTogJ2RldmVsb3AvcHJhY3RpY2UvbGxtLWFkYXB0ZXIubWQnLFxuICAgIGxhYmVsOiB7IHJvb3Q6ICdMTE0gXHU5MDAyXHU5MTREXHU1NjY4JywgZW46ICdMTE0gYWRhcHRlcicgfSxcbiAgICBzaWRlYmFyOiB7IHJvb3Q6ICd6aC1kZXZlbG9wJywgZW46ICdlbi1kZXZlbG9wJyB9LFxuICAgIHNlY3Rpb246IHsgcm9vdDogJ1x1NUI5RVx1NjIxOCcsIGVuOiAnUHJhY3RpY2UnIH0sXG4gICAgb3JkZXI6IDIsXG4gIH0sXG4gIHtcbiAgICBzb3VyY2U6ICdkb2NzL3VzZXIvZGV2ZWxvcC9wcmFjdGljZS9keW5hbWljLWNvcmRpcy5tZCcsXG4gICAgcm91dGU6ICdkZXZlbG9wL3ByYWN0aWNlL2R5bmFtaWMtY29yZGlzLm1kJyxcbiAgICBsYWJlbDogeyByb290OiAnXHU4RkQwXHU4ODRDXHU2NUY2IENvcmRpcyBcdTVERTVcdTUxNzcnLCBlbjogJ1J1bnRpbWUgQ29yZGlzIHRvb2xzJyB9LFxuICAgIHNpZGViYXI6IHsgcm9vdDogJ3poLWRldmVsb3AnLCBlbjogJ2VuLWRldmVsb3AnIH0sXG4gICAgc2VjdGlvbjogeyByb290OiAnXHU1QjlFXHU2MjE4JywgZW46ICdQcmFjdGljZScgfSxcbiAgICBvcmRlcjogMyxcbiAgfSxcbl0pXG5cbmNvbnN0IGNvcmRpc1R1dG9yaWFsID0gcGFpcmVkUGFnZXMoKFtcbiAgWydpbmRleC5tZCcsICdcdTYwM0JcdTg5QzgnLCAnT3ZlcnZpZXcnXSxcbiAgWycwMS1maXJzdC1wbHVnaW4ubWQnLCAnMS4gXHU3QjJDXHU0RTAwXHU0RTJBXHU2M0QyXHU0RUY2JywgJzEuIFlvdXIgZmlyc3QgcGx1Z2luJ10sXG4gIFsnMDItbGlmZWN5Y2xlLWFuZC1lZmZlY3RzLm1kJywgJzIuIFx1NzUxRlx1NTQ3RFx1NTQ2OFx1NjcxRlx1NEUwRVx1NTI2Rlx1NEY1Q1x1NzUyOCcsICcyLiBMaWZlY3ljbGUgYW5kIGVmZmVjdHMnXSxcbiAgWycwMy1zZXJ2aWNlcy5tZCcsICczLiBcdTY3MERcdTUyQTEnLCAnMy4gU2VydmljZXMnXSxcbiAgWycwNC1ldmVudHMubWQnLCAnNC4gXHU0RThCXHU0RUY2JywgJzQuIEV2ZW50cyddLFxuICBbJzA1LWNvbmZpZy5tZCcsICc1LiBcdTkxNERcdTdGNkUnLCAnNS4gQ29uZmlndXJhdGlvbiddLFxuICBbJzA2LWNvbXBvc2l0aW9uLWFuZC1obXIubWQnLCAnNi4gXHU3RUM0XHU1NDA4XHU0RTBFXHU3MEVEXHU5MUNEXHU4RjdEJywgJzYuIENvbXBvc2l0aW9uIGFuZCBITVInXSxcbiAgWycwNy1pbnRvLXRoZS1oYXJuZXNzLm1kJywgJzcuIFx1OEZEQlx1NTE2NSBIYXJuZXNzJywgJzcuIEludG8gdGhlIGhhcm5lc3MnXSxcbl0gYXMgY29uc3QpLm1hcCgoW2ZpbGUsIHJvb3RMYWJlbCwgZW5MYWJlbF0sIG9yZGVyKTogUGFpcmVkUGFnZSA9PiAoe1xuICBzb3VyY2U6IGBkb2NzL2NvcmRpcy10dXRvcmlhbC8ke2ZpbGV9YCxcbiAgcm91dGU6IGBkZXZlbG9wL2NvcmRpcy10dXRvcmlhbC8ke2ZpbGV9YCxcbiAgbGFiZWw6IHsgcm9vdDogcm9vdExhYmVsLCBlbjogZW5MYWJlbCB9LFxuICBzaWRlYmFyOiB7IHJvb3Q6ICd6aC1kZXZlbG9wJywgZW46ICdlbi1kZXZlbG9wJyB9LFxuICBzZWN0aW9uOiB7IHJvb3Q6ICdDb3JkaXMgXHU2ODQ2XHU2N0I2XHU2NTU5XHU3QTBCJywgZW46ICdDb3JkaXMgZnJhbWV3b3JrIHR1dG9yaWFsJyB9LFxuICBvcmRlcixcbiAgLi4uKGZpbGUgPT09ICdpbmRleC5tZCcgPyB7IHNvdXJjZUFsaWFzZXM6IFsnZG9jcy9jb3JkaXMtdHV0b3JpYWwnXSB9IDoge30pLFxufSkpKVxuXG5jb25zdCBjb3JkaXNQcmltZXJSZWZlcmVuY2UgPSBwYWlyZWRQYWdlcyhbXG4gIHtcbiAgICBzb3VyY2U6ICdkb2NzL2NvcmRpcy1wcmltZXIubWQnLFxuICAgIHJvdXRlOiAncmVmZXJlbmNlL2NvcmRpcy1wcmltZXIubWQnLFxuICAgIGxhYmVsOiB7IHJvb3Q6ICdDb3JkaXMgXHU1MTY1XHU5NUU4JywgZW46ICdDb3JkaXMgcHJpbWVyJyB9LFxuICAgIHNpZGViYXI6IHsgcm9vdDogJ3poLXJlZmVyZW5jZScsIGVuOiAnZW4tcmVmZXJlbmNlJyB9LFxuICAgIHNlY3Rpb246IHsgcm9vdDogJ1x1Njk4Mlx1NUZGNScsIGVuOiAnQ29uY2VwdHMnIH0sXG4gICAgb3JkZXI6IDEsXG4gIH0sXG5dKVxuXG4vKipcbiAqIFN1YnN5c3RlbSBwYWdlcyBncm91cGVkIGJ5IHRoZSBjb25jZXJuIHRoZXkgZG9jdW1lbnQsIGFzIGBbQ2hpbmVzZSBzZWN0aW9uLFxuICogRW5nbGlzaCBzZWN0aW9uLCBwYWdlc11gLiBPbmUgZmxhdCBsaXN0IG9mIGV2ZXJ5IHN1YnN5c3RlbSBwdXNoZWQgdGhlIHJlc3Qgb2ZcbiAqIHRoZSByZWZlcmVuY2Ugc2lkZWJhciBiZWxvdyB0aGUgZm9sZC5cbiAqL1xuY29uc3Qgc3Vic3lzdGVtR3JvdXBzID0gW1xuICBbJ1x1NjAzQlx1ODlDOCcsICdPdmVydmlldycsIFtcbiAgICBbJ1JFQURNRS5tZCcsICdcdTVCNTBcdTdDRkJcdTdFREYnLCAnU3Vic3lzdGVtcyddLFxuICBdXSxcbiAgWydcdTUxODVcdTY4MzhcdTRFMEVcdTRGNUNcdTc1MjhcdTU3REYnLCAnQ29yZSBhbmQgc2NvcGVzJywgW1xuICAgIFsnY29yZS5tZCcsICdcdTY4MzhcdTVGQzMnLCAnQ29yZSddLFxuICAgIFsnc2NvcGUubWQnLCAnXHU0RjVDXHU3NTI4XHU1N0RGJywgJ1Njb3BlcyddLFxuICAgIFsnaW52YXJpYW50cy5tZCcsICdcdThGRDBcdTg4NENcdTY1RjZcdTRFMERcdTUzRDhcdTVGMEYnLCAnUnVudGltZSBpbnZhcmlhbnRzJ10sXG4gIF1dLFxuICBbJ1x1NEYxQVx1OEJERFx1NEUwRVx1NjMwMVx1NEU0NVx1NTMxNicsICdTZXNzaW9ucyBhbmQgcGVyc2lzdGVuY2UnLCBbXG4gICAgWydzZXNzaW9uLm1kJywgJ1x1NEYxQVx1OEJERCcsICdTZXNzaW9ucyddLFxuICAgIFsnc2Vzc2lvbi1xdWVyeS5tZCcsICdcdTRGMUFcdThCRERcdTY3RTVcdThCRTInLCAnU2Vzc2lvbiBxdWVyeSddLFxuICAgIFsnc2Vzc2lvbi1yZWZlcmVuY2UubWQnLCAnXHU0RjFBXHU4QkREXHU1RjE1XHU3NTI4JywgJ1Nlc3Npb24gcmVmZXJlbmNlcyddLFxuICAgIFsnc2Vzc2lvbi10aXRsZS5tZCcsICdcdTRGMUFcdThCRERcdTY4MDdcdTk4OTgnLCAnU2Vzc2lvbiB0aXRsZXMnXSxcbiAgICBbJ3Nlc3Npb24tcHJvamVjdGlvbi5tZCcsICdcdTRGMUFcdThCRERcdTYyOTVcdTVGNzEnLCAnU2Vzc2lvbiBwcm9qZWN0aW9ucyddLFxuICAgIFsncGVyc2lzdGVuY2UubWQnLCAnXHU0RjFBXHU4QkREXHU2MzAxXHU0RTQ1XHU1MzE2JywgJ1Nlc3Npb24gcGVyc2lzdGVuY2UnXSxcbiAgICBbJ3NwaWxsLm1kJywgJ1NwaWxsIFx1NUI1OFx1NTBBOCcsICdTcGlsbCBzdG9yYWdlJ10sXG4gICAgWydzZXNzaW9uLXRlbGVtZXRyeS5tZCcsICdcdTkwNjVcdTZENEInLCAnU2Vzc2lvblRlbGVtZXRyeUJhY2tlbmQnXSxcbiAgXV0sXG4gIFsnXHU2QTIxXHU1NzhCXHU0RTBFXHU0RTBBXHU0RTBCXHU2NTg3JywgJ01vZGVsIGFuZCBjb250ZXh0JywgW1xuICAgIFsnbGxtLXN0cmVhbWluZy5tZCcsICdMTE0gXHU2RDQxXHU1RjBGXHU1NENEXHU1RTk0JywgJ0xMTSBzdHJlYW1pbmcnXSxcbiAgICBbJ3Rva2VuLW1ldGVyLm1kJywgJ1Rva2VuIFx1OEJBMVx1OTFDRicsICdUb2tlbiBtZXRlcmluZyddLFxuICAgIFsnc3lzdGVtLXByb21wdC5tZCcsICdcdTdDRkJcdTdFREZcdTYzRDBcdTc5M0FcdThCQ0QnLCAnU3lzdGVtIHByb21wdHMnXSxcbiAgICBbJ2NvbXBhY3Rpb24ubWQnLCAnXHU0RTBBXHU0RTBCXHU2NTg3XHU1MzhCXHU3RjI5JywgJ0NvbXBhY3Rpb24nXSxcbiAgXV0sXG4gIFsnXHU2MjY3XHU4ODRDXHU0RTBFXHU1REU1XHU1MTc3JywgJ0V4ZWN1dGlvbiBhbmQgdG9vbHMnLCBbXG4gICAgWyd0b29scy5tZCcsICdcdTVERTVcdTUxNzcnLCAnVG9vbHMnXSxcbiAgICBbJ3NoZWxsLm1kJywgJ0Jhc2ggXHU2MjY3XHU4ODRDJywgJ0Jhc2ggZXhlY3V0aW9uJ10sXG4gICAgWydzdWJwcm9jZXNzLm1kJywgJ1x1NUI1MFx1OEZEQlx1N0EwQicsICdTdWJwcm9jZXNzZXMnXSxcbiAgICBbJ3Rlcm1pbmFsLm1kJywgJ1BUWSBcdTRGMUFcdThCREQnLCAnUFRZIHNlc3Npb25zJ10sXG4gICAgWydqb2JzLm1kJywgJ1x1NTQwRVx1NTNGMFx1NEVGQlx1NTJBMScsICdCYWNrZ3JvdW5kIGpvYnMnXSxcbiAgICBbJ2ZpbGVzeXN0ZW0ubWQnLCAnXHU2NTg3XHU0RUY2XHU3Q0ZCXHU3RURGJywgJ0ZpbGVzeXN0ZW0nXSxcbiAgICBbJ2xzcC5tZCcsICdMU1AgXHU1QkZDXHU4MjJBJywgJ0xTUCBuYXZpZ2F0aW9uJ10sXG4gICAgWydjb2RlLXJ1bnRpbWUubWQnLCAnXHU0RUUzXHU3ODAxXHU4RkQwXHU4ODRDXHU2NUY2JywgJ0NvZGUgcnVudGltZSddLFxuICAgIFsnd2ViLm1kJywgJ1dlYiBcdThCQkZcdTk1RUUnLCAnV2ViIGFjY2VzcyddLFxuICAgIFsnc2tpbGxzLm1kJywgJ1x1NjI4MFx1ODBGRCcsICdTa2lsbHMnXSxcbiAgICBbJ3dvcmtmbG93Lm1kJywgJ1x1NURFNVx1NEY1Q1x1NkQ0MScsICdXb3JrZmxvd3MnXSxcbiAgICBbJ3N1YmFnZW50Lm1kJywgJ1x1NUI1MFx1NEVFM1x1NzQwNicsICdTdWJhZ2VudHMnXSxcbiAgXV0sXG4gIFsnXHU3QjU2XHU3NTY1XHU0RTBFXHU0RUE0XHU0RTkyJywgJ1BvbGljeSBhbmQgaW50ZXJhY3Rpb24nLCBbXG4gICAgWydhcHByb3ZhbC5tZCcsICdcdTVCQTFcdTYyNzknLCAnQXBwcm92YWxzJ10sXG4gICAgWydwZXJtaXNzaW9uLXByZXNldHMubWQnLCAnXHU2NzQzXHU5NjUwXHU5ODg0XHU4QkJFJywgJ1Blcm1pc3Npb24gcHJlc2V0cyddLFxuICAgIFsnc2FuZGJveC5tZCcsICdcdTZDOTlcdTdCQjEnLCAnU2FuZGJveGluZyddLFxuICAgIFsncGxhbi5tZCcsICdcdThCQTFcdTUyMTJcdTZBMjFcdTVGMEYnLCAnUGxhbiBtb2RlJ10sXG4gICAgWyd1c2VyLXF1ZXN0aW9ucy5tZCcsICdcdTc1MjhcdTYyMzdcdTRFQTRcdTRFOTInLCAnVXNlciBpbnRlcmFjdGlvbiddLFxuICAgIFsnY29tbWFuZHMubWQnLCAnXHU1NDdEXHU0RUU0JywgJ0h1bWFuIGNvbW1hbmRzJ10sXG4gICAgWydnb2FsLm1kJywgJ1x1NzZFRVx1NjgwNycsICdHb2FscyddLFxuICAgIFsnc2NoZWR1bGUubWQnLCAnXHU1QjlBXHU2NUY2XHU2M0QwXHU5MTkyJywgJ1NjaGVkdWxlZCByZW1pbmRlcnMnXSxcbiAgXV0sXG4gIFsnXHU1RTczXHU1M0YwXHU0RTBFXHU2M0E1XHU1MTY1JywgJ1BsYXRmb3JtIGFuZCBhY2Nlc3MnLCBbXG4gICAgWyd3ZWItc2VydmVyLm1kJywgJ0hUVFAgXHU2NzBEXHU1MkExXHU1NjY4JywgJ0hUVFAgc2VydmVyJ10sXG4gICAgWyd3ZWItY2xpZW50Lm1kJywgJ1dlYiBDbGllbnQgXHU2N0I2XHU2Nzg0JywgJ1dlYiBDbGllbnQgYXJjaGl0ZWN0dXJlJ10sXG4gICAgWydjbGllbnQtbW9kdWxlcy5tZCcsICdcdTVCQTJcdTYyMzdcdTdBRUZcdTZBMjFcdTU3NTcnLCAnQ2xpZW50IG1vZHVsZXMnXSxcbiAgICBbJ3Nsb3RzLm1kJywgJ1x1NUJBMlx1NjIzN1x1N0FFRiBTbG90cycsICdDbGllbnQgc2xvdHMnXSxcbiAgICBbJ2NsaWVudC1yZXNvdXJjZXMubWQnLCAnXHU1QkEyXHU2MjM3XHU3QUVGXHU4RDQ0XHU2RTkwJywgJ0NsaWVudCByZXNvdXJjZXMnXSxcbiAgICBbJ3NpZGViYXItcmlnaHQubWQnLCAnXHU1M0YzXHU0RkE3IFNpZGViYXInLCAnUmlnaHQgU2lkZWJhciddLFxuICAgIFsnY29udmVyc2F0aW9uLm1kJywgJ0NvbnZlcnNhdGlvbiBcdTdFQzRcdTg4QzUnLCAnQ29udmVyc2F0aW9uIGFzc2VtYmx5J10sXG4gICAgWyd0eXBlcnQubWQnLCAnVHlwZXJ0JywgJ1R5cGVydCddLFxuICAgIFsnc3RvcmFnZS5tZCcsICdcdTVCNThcdTUwQTgnLCAnU3RvcmFnZSddLFxuICAgIFsnd29ya3NwYWNlLm1kJywgJ1x1NURFNVx1NEY1Q1x1NTMzQScsICdXb3Jrc3BhY2VzJ10sXG4gICAgWydzZXR0aW5ncy5tZCcsICdcdTc1MjhcdTYyMzdcdThCQkVcdTdGNkUnLCAnVXNlciBzZXR0aW5ncyddLFxuICAgIFsnY3JlZGVudGlhbHMubWQnLCAnXHU3NTI4XHU2MjM3XHU1MUVEXHU2MzZFJywgJ1VzZXIgY3JlZGVudGlhbHMnXSxcbiAgXV0sXG5dIGFzIGNvbnN0XG5cbmNvbnN0IHN1YnN5c3RlbXNSZWZlcmVuY2UgPSBzdWJzeXN0ZW1Hcm91cHMuZmxhdE1hcCgoW3Jvb3RTZWN0aW9uLCBlblNlY3Rpb24sIGZpbGVzXSkgPT4gcGFpcmVkUGFnZXMoXG4gIGZpbGVzLm1hcCgoW2ZpbGUsIHJvb3RMYWJlbCwgZW5MYWJlbF0sIG9yZGVyKTogUGFpcmVkUGFnZSA9PiAoe1xuICAgIHNvdXJjZTogYGRvY3Mvc3Vic3lzdGVtcy8ke2ZpbGV9YCxcbiAgICByb3V0ZTogZmlsZSA9PT0gJ1JFQURNRS5tZCcgPyAncmVmZXJlbmNlL3N1YnN5c3RlbXMvaW5kZXgubWQnIDogYHJlZmVyZW5jZS9zdWJzeXN0ZW1zLyR7ZmlsZX1gLFxuICAgIGxhYmVsOiB7IHJvb3Q6IHJvb3RMYWJlbCwgZW46IGVuTGFiZWwgfSxcbiAgICBzaWRlYmFyOiB7IHJvb3Q6ICd6aC1yZWZlcmVuY2UnLCBlbjogJ2VuLXJlZmVyZW5jZScgfSxcbiAgICBzZWN0aW9uOiB7IHJvb3Q6IHJvb3RTZWN0aW9uLCBlbjogZW5TZWN0aW9uIH0sXG4gICAgb3JkZXIsXG4gICAgLy8gU3Vic3lzdGVtIHBhZ2VzIGNhcnJ5IGxvbmcgdGhpcmQtbGV2ZWwgc2VjdGlvbnMgYSB0d28tbGV2ZWwgb3V0bGluZSByZWFjaGVzLlxuICAgIG91dGxpbmU6IFsyLCAzXSxcbiAgICAuLi4oZmlsZSA9PT0gJ1JFQURNRS5tZCcgPyB7IHNvdXJjZUFsaWFzZXM6IFsnZG9jcy9zdWJzeXN0ZW1zJ10gfSA6IHt9KSxcbiAgfSkpLFxuKSlcblxuY29uc3QgcmVmZXJlbmNlID0gW1xuICAvLyBgZG9jcy9kZWVwc2Vlay1sbG0tYXBpLXdpcmUtZXh0ZW5zaW9ucy5tZGAgaXMgYSByZXBvc2l0b3J5LW9ubHkgcHJvdmlkZXIgcHJvdG9jb2wgcmVmZXJlbmNlLlxuICAvLyBQcm9qZWN0ZWQgbGlua3MgaW50ZW50aW9uYWxseSByZXNvbHZlIHRvIGl0cyBHaXRIdWIgc291cmNlIGluc3RlYWQgb2YgYSBwdWJsaWMgc2l0ZSByb3V0ZS5cbiAgLi4ucGFpcmVkUGFnZXMoKFtcbiAgICBbJ2RvY3MvYXJjaGl0ZWN0dXJlLm1kJywgJ3JlZmVyZW5jZS9pbmRleC5tZCcsICdcdTY3QjZcdTY3ODQnLCAnQXJjaGl0ZWN0dXJlJywgMF0sXG4gIF0gYXMgY29uc3QpLm1hcCgoW3NvdXJjZSwgcm91dGUsIHJvb3RMYWJlbCwgZW5MYWJlbCwgb3JkZXJdKTogUGFpcmVkUGFnZSA9PiAoe1xuICAgIHNvdXJjZSxcbiAgICByb3V0ZSxcbiAgICBsYWJlbDogeyByb290OiByb290TGFiZWwsIGVuOiBlbkxhYmVsIH0sXG4gICAgc2lkZWJhcjogeyByb290OiAnemgtcmVmZXJlbmNlJywgZW46ICdlbi1yZWZlcmVuY2UnIH0sXG4gICAgc2VjdGlvbjogeyByb290OiAnXHU2OTgyXHU1RkY1JywgZW46ICdDb25jZXB0cycgfSxcbiAgICBvcmRlcixcbiAgfSkpKSxcbiAgLi4ucGFpcmVkUGFnZXMoKFtcbiAgICBbJ2RvY3MvY2FwYWJpbGl0eS1zZWFtcy5tZCcsICdyZWZlcmVuY2UvY2FwYWJpbGl0eS1zZWFtcy5tZCcsICdcdTgwRkRcdTUyOUJcdTY3MERcdTUyQTEnLCAnQ2FwYWJpbGl0eSBzZXJ2aWNlcycsIDJdLFxuICAgIFsnZG9jcy9hZ2VudC1saWZlY3ljbGUubWQnLCAncmVmZXJlbmNlL2FnZW50LWxpZmVjeWNsZS5tZCcsICdBZ2VudCBcdTc1MUZcdTU0N0RcdTU0NjhcdTY3MUYnLCAnQWdlbnQgbGlmZWN5Y2xlJywgM10sXG4gICAgWydkb2NzL3Rvb2wtZXhlY3V0aW9uLXBpcGVsaW5lLm1kJywgJ3JlZmVyZW5jZS90b29sLWV4ZWN1dGlvbi1waXBlbGluZS5tZCcsICdUb29sIFx1NjI2N1x1ODg0QycsICdUb29sIGV4ZWN1dGlvbicsIDRdLFxuICAgIFsnZG9jcy9hcGktZ2F0ZXdheS5tZCcsICdyZWZlcmVuY2UvYXBpLWdhdGV3YXkubWQnLCAnQVBJIEdhdGV3YXknLCAnQVBJIEdhdGV3YXknLCA1XSxcbiAgXSBhcyBjb25zdCkubWFwKChbc291cmNlLCByb3V0ZSwgcm9vdExhYmVsLCBlbkxhYmVsLCBvcmRlcl0pOiBQYWlyZWRQYWdlID0+ICh7XG4gICAgc291cmNlLFxuICAgIHJvdXRlLFxuICAgIGxhYmVsOiB7IHJvb3Q6IHJvb3RMYWJlbCwgZW46IGVuTGFiZWwgfSxcbiAgICBzaWRlYmFyOiB7IHJvb3Q6ICd6aC1yZWZlcmVuY2UnLCBlbjogJ2VuLXJlZmVyZW5jZScgfSxcbiAgICBzZWN0aW9uOiB7IHJvb3Q6ICdcdTY5ODJcdTVGRjUnLCBlbjogJ0NvbmNlcHRzJyB9LFxuICAgIG9yZGVyLFxuICB9KSkpLFxuICAuLi5wYWlyZWRQYWdlcygoW1xuICAgIFsnZG9jcy9jb25maWctY2F0YWxvZy5tZCcsICdyZWZlcmVuY2UvY29uZmlnLWNhdGFsb2cubWQnLCAnXHU2M0QyXHU0RUY2XHU5MTREXHU3RjZFJywgJ1BsdWdpbiBjb25maWd1cmF0aW9uJ10sXG4gICAgWydkb2NzL3Rvb2wtY2F0YWxvZy5tZCcsICdyZWZlcmVuY2UvdG9vbC1jYXRhbG9nLm1kJywgJ1Rvb2wgU2NoZW1hJywgJ1Rvb2wgc2NoZW1hcyddLFxuICAgIFsnZG9jcy9wZXJzaXN0ZW5jZS1jYXRhbG9nLm1kJywgJ3JlZmVyZW5jZS9wZXJzaXN0ZW5jZS1jYXRhbG9nLm1kJywgJ1x1NjMwMVx1NEU0NVx1NTMxNlx1NEU4Qlx1NEVGNicsICdQZXJzaXN0ZW5jZSBldmVudHMnLCAnZGVlcCddLFxuICBdIGFzIGNvbnN0KS5tYXAoKFtzb3VyY2UsIHJvdXRlLCByb290TGFiZWwsIGVuTGFiZWwsIG91dGxpbmVdLCBvcmRlcik6IFBhaXJlZFBhZ2UgPT4gKHtcbiAgICBzb3VyY2UsXG4gICAgcm91dGUsXG4gICAgbGFiZWw6IHsgcm9vdDogcm9vdExhYmVsLCBlbjogZW5MYWJlbCB9LFxuICAgIHNpZGViYXI6IHsgcm9vdDogJ3poLXJlZmVyZW5jZScsIGVuOiAnZW4tcmVmZXJlbmNlJyB9LFxuICAgIHNlY3Rpb246IHsgcm9vdDogJ1x1NzUxRlx1NjIxMFx1NTNDMlx1ODAwMycsIGVuOiAnR2VuZXJhdGVkIHJlZmVyZW5jZScgfSxcbiAgICBvcmRlcixcbiAgICAuLi4ob3V0bGluZSA9PT0gdW5kZWZpbmVkID8ge30gOiB7IG91dGxpbmUgfSksXG4gIH0pKSksXG4gIC4uLnBhaXJlZFBhZ2VzKChbXG4gICAgWydjb250ZXh0Lm1kJywgJ0NvbnRleHQnLCAnQ29udGV4dCddLFxuICAgIFsnZXZlbnRzLm1kJywgJ0V2ZW50cycsICdFdmVudHMnXSxcbiAgICBbJ2ZpYmVyLm1kJywgJ0ZpYmVyJywgJ0ZpYmVyJ10sXG4gICAgWydyZWdpc3RyeS5tZCcsICdQbHVnaW4gUmVnaXN0cnknLCAnUGx1Z2luIFJlZ2lzdHJ5J10sXG4gICAgWydzZXJ2aWNlLm1kJywgJ1NlcnZpY2UnLCAnU2VydmljZSddLFxuICBdIGFzIGNvbnN0KS5tYXAoKFtmaWxlLCByb290TGFiZWwsIGVuTGFiZWxdLCBvcmRlcik6IFBhaXJlZFBhZ2UgPT4gKHtcbiAgICBzb3VyY2U6IGBkb2NzL2NvcmRpcy1hcGkvJHtmaWxlfWAsXG4gICAgcm91dGU6IGByZWZlcmVuY2UvY29yZGlzLWFwaS8ke2ZpbGV9YCxcbiAgICBsYWJlbDogeyByb290OiByb290TGFiZWwsIGVuOiBlbkxhYmVsIH0sXG4gICAgc2lkZWJhcjogeyByb290OiAnemgtcmVmZXJlbmNlJywgZW46ICdlbi1yZWZlcmVuY2UnIH0sXG4gICAgc2VjdGlvbjogeyByb290OiAnQ29yZGlzIEFQSScsIGVuOiAnQ29yZGlzIENvcmUgQVBJJyB9LFxuICAgIG9yZGVyLFxuICB9KSkpLFxuICAuLi5taXJyb3JlZFBhZ2VzKChbXG4gICAgWydpbmhlcml0ZWQubWQnLCAnXHU3RUU3XHU2MjdGXHU2M0E1XHU1M0UzXHU5NzYyJywgJ0luaGVyaXRlZCBzdXJmYWNlJ10sXG4gIF0gYXMgY29uc3QpLm1hcCgoW2ZpbGUsIHJvb3RMYWJlbCwgZW5MYWJlbF0sIG9yZGVyKTogTWlycm9yZWRQYWdlID0+ICh7XG4gICAgc291cmNlOiBgZG9jcy9jb3JkaXMtYXBpLyR7ZmlsZX1gLFxuICAgIHJvdXRlOiBgcmVmZXJlbmNlL2NvcmRpcy1hcGkvJHtmaWxlfWAsXG4gICAgY29udGVudExvY2FsZTogJ2VuLVVTJyxcbiAgICBsYWJlbDogeyByb290OiByb290TGFiZWwsIGVuOiBlbkxhYmVsIH0sXG4gICAgc2lkZWJhcjogeyByb290OiAnemgtcmVmZXJlbmNlJywgZW46ICdlbi1yZWZlcmVuY2UnIH0sXG4gICAgc2VjdGlvbjogeyByb290OiAnQ29yZGlzIEFQSScsIGVuOiAnQ29yZGlzIENvcmUgQVBJJyB9LFxuICAgIG9yZGVyOiBvcmRlciArIDUsXG4gIH0pKSksXG4gIC4uLnBhaXJlZFBhZ2VzKChbXG4gICAgWydhZGRpbmctYS1wYWNrYWdlLm1kJywgJ1x1NjVCMFx1NTg5RSBQYWNrYWdlJywgJ0FkZGluZyBhIHBhY2thZ2UnXSxcbiAgICBbJ2FkZGluZy1hLXRvb2wubWQnLCAnXHU2NUIwXHU1ODlFIFRvb2wnLCAnQWRkaW5nIGEgdG9vbCddLFxuICAgIFsnYWRkaW5nLWFuLWxsbS1hZGFwdGVyLm1kJywgJ1x1NjVCMFx1NTg5RSBMTE0gQWRhcHRlcicsICdBZGRpbmcgYW4gTExNIGFkYXB0ZXInXSxcbiAgICBbJ2FkZGluZy1hLXNldHRpbmdzLWNhcmQubWQnLCAnXHU2NUIwXHU1ODlFXHU4QkJFXHU3RjZFXHU1MzYxXHU3MjQ3JywgJ0FkZGluZyBhIHNldHRpbmdzIGNhcmQnXSxcbiAgICBbJ2V4dGVuc2lvbi1jb29rYm9vay5tZCcsICdcdTYyNjlcdTVDNTVcdTZBMjFcdTVGMEYnLCAnRXh0ZW5zaW9uIHBhdHRlcm5zJ10sXG4gIF0gYXMgY29uc3QpLm1hcCgoW2ZpbGUsIHJvb3RMYWJlbCwgZW5MYWJlbF0sIG9yZGVyKTogUGFpcmVkUGFnZSA9PiAoe1xuICAgIHNvdXJjZTogYGRvY3MvY29va2Jvb2svJHtmaWxlfWAsXG4gICAgcm91dGU6IGByZWZlcmVuY2UvY29va2Jvb2svJHtmaWxlfWAsXG4gICAgbGFiZWw6IHsgcm9vdDogcm9vdExhYmVsLCBlbjogZW5MYWJlbCB9LFxuICAgIHNpZGViYXI6IHsgcm9vdDogJ3poLXJlZmVyZW5jZScsIGVuOiAnZW4tcmVmZXJlbmNlJyB9LFxuICAgIHNlY3Rpb246IHsgcm9vdDogJ1x1NUYwMFx1NTNEMVx1NjI0Qlx1NTE4QycsIGVuOiAnQ29va2Jvb2snIH0sXG4gICAgb3JkZXIsXG4gIH0pKSksXG5dXG5cbi8qKlxuICogU2lkZWJhciBjb2xsZWN0aW9ucyBvZiBlYWNoIGxvY2FsZSwgaW4gdGhlIG9yZGVyIHRoZSBzaXRlJ3MgbmF2aWdhdGlvblxuICogcHJlc2VudHMgdGhlbS4gVGhlIG5hdmlnYXRpb24gYmFyIGFuZCB0aGUgbGxtcy50eHQgaW5kZXggYm90aCByZWFkIHRoaXNcbiAqIHNlcXVlbmNlLCBzbyBhIG5ldyBjb2xsZWN0aW9uIGxhbmRzIGluIGJvdGggc3VyZmFjZXMgdG9nZXRoZXIuXG4gKi9cbmV4cG9ydCBjb25zdCBsb2NhbGVDb2xsZWN0aW9ucyA9IHtcbiAgcm9vdDogWyd6aC1ndWlkZScsICd6aC1kZXZlbG9wJywgJ3poLXJlZmVyZW5jZSddLFxuICBlbjogWydlbi1ndWlkZScsICdlbi1kZXZlbG9wJywgJ2VuLXJlZmVyZW5jZSddLFxufSBhcyBjb25zdCBzYXRpc2ZpZXMgUmVjb3JkPERvY3NMb2NhbGUsIHJlYWRvbmx5IERvY3NTaWRlYmFyW10+XG5cbi8qKiBBIHNpZGViYXIgZ3JvdXAsIG1hdGNoZWQgdG8gcGFnZXMgYnkgYGxhYmVsYC4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgRG9jc1NlY3Rpb24ge1xuICAvKiogR3JvdXAgaGVhZGluZywgZXF1YWwgdG8gdGhlIGBzZWN0aW9uYCBmaWVsZCBvZiBldmVyeSBwYWdlIGl0IGhvbGRzLiAqL1xuICBsYWJlbDogc3RyaW5nXG4gIC8qKiBSZW5kZXIgdGhlIGdyb3VwIGNvbGxhcHNlZCB1bnRpbCBpdCBob2xkcyB0aGUgcGFnZSBiZWluZyByZWFkLiAqL1xuICBjb2xsYXBzZWQ/OiBib29sZWFuXG59XG5cbi8qKlxuICogRXZlcnkgc2lkZWJhciBncm91cCwgaW4gdGhlIG9yZGVyIGl0cyBsb2NhbGUgcmVuZGVycyBpdC5cbiAqXG4gKiBUaGUgc3Vic3lzdGVtIGdyb3VwcyBjb2xsYXBzZSBiZWNhdXNlIHRvZ2V0aGVyIHRoZXkgb3V0bnVtYmVyIHRoZSByZXN0IG9mIHRoZVxuICogcmVmZXJlbmNlIHNpZGViYXI7IGV4cGFuZGVkLCB0aGV5IHB1c2ggZXZlcnkgb3RoZXIgZ3JvdXAgYmVsb3cgdGhlIGZvbGQuXG4gKi9cbmNvbnN0IHNlY3Rpb25zOiBSZWNvcmQ8RG9jc0xvY2FsZSwgcmVhZG9ubHkgRG9jc1NlY3Rpb25bXT4gPSB7XG4gIHJvb3Q6IFtcbiAgICB7IGxhYmVsOiAnXHU1MTY1XHU5NUU4JyB9LCB7IGxhYmVsOiAnU0RLJyB9LCB7IGxhYmVsOiAnXHU4MUVBXHU1MkE4XHU1MzE2JyB9LCB7IGxhYmVsOiAnXHU5NkM2XHU2MjEwJyB9LFxuICAgIHsgbGFiZWw6ICdcdTU3RkFcdTc4NDAnIH0sIHsgbGFiZWw6ICdcdTY4NDZcdTY3QjZcdTgwRkRcdTUyOUInIH0sIHsgbGFiZWw6ICdcdTVCOUVcdTYyMTgnIH0sIHsgbGFiZWw6ICdDb3JkaXMgXHU2ODQ2XHU2N0I2XHU2NTU5XHU3QTBCJyB9LFxuICAgIHsgbGFiZWw6ICdcdTY5ODJcdTVGRjUnIH0sIHsgbGFiZWw6ICdcdTc1MUZcdTYyMTBcdTUzQzJcdTgwMDMnIH0sIHsgbGFiZWw6ICdDb3JkaXMgQVBJJyB9LCB7IGxhYmVsOiAnXHU1RjAwXHU1M0QxXHU2MjRCXHU1MThDJyB9LFxuICAgIHsgbGFiZWw6ICdcdTYwM0JcdTg5QzgnIH0sXG4gICAgeyBsYWJlbDogJ1x1NTE4NVx1NjgzOFx1NEUwRVx1NEY1Q1x1NzUyOFx1NTdERicsIGNvbGxhcHNlZDogdHJ1ZSB9LFxuICAgIHsgbGFiZWw6ICdcdTRGMUFcdThCRERcdTRFMEVcdTYzMDFcdTRFNDVcdTUzMTYnLCBjb2xsYXBzZWQ6IHRydWUgfSxcbiAgICB7IGxhYmVsOiAnXHU2QTIxXHU1NzhCXHU0RTBFXHU0RTBBXHU0RTBCXHU2NTg3JywgY29sbGFwc2VkOiB0cnVlIH0sXG4gICAgeyBsYWJlbDogJ1x1NjI2N1x1ODg0Q1x1NEUwRVx1NURFNVx1NTE3NycsIGNvbGxhcHNlZDogdHJ1ZSB9LFxuICAgIHsgbGFiZWw6ICdcdTdCNTZcdTc1NjVcdTRFMEVcdTRFQTRcdTRFOTInLCBjb2xsYXBzZWQ6IHRydWUgfSxcbiAgICB7IGxhYmVsOiAnXHU1RTczXHU1M0YwXHU0RTBFXHU2M0E1XHU1MTY1JywgY29sbGFwc2VkOiB0cnVlIH0sXG4gIF0sXG4gIGVuOiBbXG4gICAgeyBsYWJlbDogJ0d1aWRlJyB9LCB7IGxhYmVsOiAnU0RLJyB9LCB7IGxhYmVsOiAnQXV0b21hdGlvbicgfSwgeyBsYWJlbDogJ0ludGVncmF0aW9ucycgfSxcbiAgICB7IGxhYmVsOiAnQmFzaWNzJyB9LCB7IGxhYmVsOiAnRnJhbWV3b3JrJyB9LCB7IGxhYmVsOiAnUHJhY3RpY2UnIH0sIHsgbGFiZWw6ICdDb3JkaXMgZnJhbWV3b3JrIHR1dG9yaWFsJyB9LFxuICAgIHsgbGFiZWw6ICdDb25jZXB0cycgfSwgeyBsYWJlbDogJ0dlbmVyYXRlZCByZWZlcmVuY2UnIH0sIHsgbGFiZWw6ICdDb3JkaXMgQ29yZSBBUEknIH0sIHsgbGFiZWw6ICdDb29rYm9vaycgfSxcbiAgICB7IGxhYmVsOiAnT3ZlcnZpZXcnIH0sXG4gICAgeyBsYWJlbDogJ0NvcmUgYW5kIHNjb3BlcycsIGNvbGxhcHNlZDogdHJ1ZSB9LFxuICAgIHsgbGFiZWw6ICdTZXNzaW9ucyBhbmQgcGVyc2lzdGVuY2UnLCBjb2xsYXBzZWQ6IHRydWUgfSxcbiAgICB7IGxhYmVsOiAnTW9kZWwgYW5kIGNvbnRleHQnLCBjb2xsYXBzZWQ6IHRydWUgfSxcbiAgICB7IGxhYmVsOiAnRXhlY3V0aW9uIGFuZCB0b29scycsIGNvbGxhcHNlZDogdHJ1ZSB9LFxuICAgIHsgbGFiZWw6ICdQb2xpY3kgYW5kIGludGVyYWN0aW9uJywgY29sbGFwc2VkOiB0cnVlIH0sXG4gICAgeyBsYWJlbDogJ1BsYXRmb3JtIGFuZCBhY2Nlc3MnLCBjb2xsYXBzZWQ6IHRydWUgfSxcbiAgXSxcbn1cblxuLyoqXG4gKiBQbGFjZW1lbnQgYW5kIGNvbGxhcHNlIGJlaGF2aW9yIG9mIG9uZSBzaWRlYmFyIGdyb3VwLlxuICpcbiAqIEBwYXJhbSBsb2NhbGUgLSBSb3V0ZSB0cmVlIHdob3NlIHNpZGViYXIgaXMgYmVpbmcgYnVpbHQuXG4gKiBAcGFyYW0gbGFiZWwgLSBTZWN0aW9uIGxhYmVsIGNhcnJpZWQgYnkgdGhlIHBhZ2VzIGluIHRoZSBncm91cC5cbiAqIEByZXR1cm5zIFRoZSBkZWNsYXJlZCBncm91cCwgcGx1cyBpdHMgemVyby1iYXNlZCBwb3NpdGlvbiBpbiB0aGUgbG9jYWxlLlxuICogQHRocm93cyBXaGVuIHRoZSBsb2NhbGUgZGVjbGFyZXMgbm8gcGxhY2VtZW50IGZvciB0aGUgbGFiZWwuIFJhbmtpbmcgYnkgbGlzdFxuICogICBtZW1iZXJzaGlwIGFsb25lIHdvdWxkIHNvcnQgYW4gdW5kZWNsYXJlZCBncm91cCBzaWxlbnRseSBhaGVhZCBvZiBldmVyeVxuICogICBkZWNsYXJlZCBvbmUuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzZWN0aW9uU3BlYyhsb2NhbGU6IERvY3NMb2NhbGUsIGxhYmVsOiBzdHJpbmcpOiBEb2NzU2VjdGlvbiAmIHsgaW5kZXg6IG51bWJlciB9IHtcbiAgY29uc3QgZGVjbGFyZWQgPSBzZWN0aW9uc1tsb2NhbGVdXG4gIGNvbnN0IHNlY3Rpb24gPSBkZWNsYXJlZC5maW5kKGNhbmRpZGF0ZSA9PiBjYW5kaWRhdGUubGFiZWwgPT09IGxhYmVsKVxuICBpZiAoc2VjdGlvbiA9PT0gdW5kZWZpbmVkKSB0aHJvdyBuZXcgRXJyb3IoYFNpZGViYXIgc2VjdGlvbiBcIiR7bGFiZWx9XCIgaGFzIG5vIHBsYWNlbWVudCBpbiB0aGUgJHtsb2NhbGV9IGxvY2FsZS5gKVxuICByZXR1cm4geyAuLi5zZWN0aW9uLCBpbmRleDogZGVjbGFyZWQuaW5kZXhPZihzZWN0aW9uKSB9XG59XG5cbi8qKiBFdmVyeSBjYW5vbmljYWwgcGFnZSBwdWJsaXNoZWQgYnkgdGhlIGRvY3VtZW50YXRpb24gd2Vic2l0ZS4gKi9cbmV4cG9ydCBjb25zdCBkb2NzUGFnZXM6IERvY3NQYWdlW10gPSBbXG4gIC4uLmhvbWVBbmRHdWlkZSxcbiAgLi4uZGV2ZWxvcCxcbiAgLi4uY29yZGlzVHV0b3JpYWwsXG4gIC4uLmNvcmRpc1ByaW1lclJlZmVyZW5jZSxcbiAgLi4uc3Vic3lzdGVtc1JlZmVyZW5jZSxcbiAgLi4ucmVmZXJlbmNlLFxuXVxuXG4vKipcbiAqIFBhZ2VzIG9mIG9uZSBzaWRlYmFyIGNvbGxlY3Rpb24sIGluIHRoZSBvcmRlciB0aGUgc2lkZWJhciBsaXN0cyB0aGVtLlxuICpcbiAqIEBwYXJhbSBsb2NhbGUgLSBSb3V0ZSB0cmVlIHdob3NlIHNpZGViYXIgaXMgYmVpbmcgYnVpbHQuXG4gKiBAcGFyYW0gY29sbGVjdGlvbiAtIFNpZGViYXIgY29sbGVjdGlvbiB0byByZWFkLlxuICogQHJldHVybnMgVGhlIGNvbGxlY3Rpb24ncyBwYWdlcywgb3JkZXJlZCBieSBzZWN0aW9uIHBsYWNlbWVudCB0aGVuIGJ5IGBvcmRlcmAuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBvcmRlcmVkUGFnZXMobG9jYWxlOiBEb2NzTG9jYWxlLCBjb2xsZWN0aW9uOiBEb2NzU2lkZWJhcik6IERvY3NQYWdlW10ge1xuICByZXR1cm4gZG9jc1BhZ2VzXG4gICAgLmZpbHRlcihwYWdlID0+IHBhZ2UubG9jYWxlID09PSBsb2NhbGUgJiYgcGFnZS5zaWRlYmFyID09PSBjb2xsZWN0aW9uKVxuICAgIC5zb3J0KChsZWZ0LCByaWdodCkgPT4gKFxuICAgICAgc2VjdGlvblNwZWMobG9jYWxlLCBsZWZ0LnNlY3Rpb24pLmluZGV4IC0gc2VjdGlvblNwZWMobG9jYWxlLCByaWdodC5zZWN0aW9uKS5pbmRleFxuICAgICAgfHwgbGVmdC5vcmRlciAtIHJpZ2h0Lm9yZGVyXG4gICAgKSlcbn1cblxuLyoqXG4gKiBTaXRlLXJlbGF0aXZlIGxpbmsgZm9yIGEgcHVibGlzaGVkIHJvdXRlLlxuICpcbiAqIEBwYXJhbSByb3V0ZSAtIE1hbmlmZXN0IHJvdXRlLCBpbmNsdWRpbmcgaXRzIGAubWRgIHN1ZmZpeC5cbiAqIEByZXR1cm5zIFRoZSBsaW5rIFZpdGVQcmVzcyBzZXJ2ZXMgdGhlIHJvdXRlIGF0LlxuICovXG5leHBvcnQgZnVuY3Rpb24gcm91dGVMaW5rKHJvdXRlOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gYC8ke3JvdXRlLnJlcGxhY2UoLyg/OmluZGV4KT9cXC5tZCQvLCAnJyl9YFxufVxuXG4vKipcbiAqIFdoZXJlIGEgdG9wLWxldmVsIG5hdmlnYXRpb24gaXRlbSBsYW5kcy5cbiAqXG4gKiBUaGUgdGFyZ2V0IGlzIGRlcml2ZWQgcmF0aGVyIHRoYW4gd3JpdHRlbiBkb3duOiBhIGNvbGxlY3Rpb24gd2hvc2UgZmlyc3QgcGFnZVxuICogaXMgcmVuYW1lZCBvciByZW9yZGVyZWQgd291bGQgb3RoZXJ3aXNlIGxlYXZlIHRoZSBuYXZpZ2F0aW9uIGJhciBwb2ludGluZyBhdFxuICogYSByb3V0ZSB0aGUgbWFuaWZlc3Qgbm8gbG9uZ2VyIHB1Ymxpc2hlcy5cbiAqXG4gKiBAcGFyYW0gbG9jYWxlIC0gUm91dGUgdHJlZSB0aGUgbmF2aWdhdGlvbiBpdGVtIGJlbG9uZ3MgdG8uXG4gKiBAcGFyYW0gY29sbGVjdGlvbiAtIFNpZGViYXIgY29sbGVjdGlvbiB0aGUgaXRlbSBvcGVucy5cbiAqIEByZXR1cm5zIFNpdGUtcmVsYXRpdmUgbGluayBvZiB0aGUgY29sbGVjdGlvbidzIGZpcnN0IHBhZ2UuXG4gKiBAdGhyb3dzIFdoZW4gdGhlIGNvbGxlY3Rpb24gcHVibGlzaGVzIG5vIHBhZ2UuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBsYW5kaW5nTGluayhsb2NhbGU6IERvY3NMb2NhbGUsIGNvbGxlY3Rpb246IERvY3NTaWRlYmFyKTogc3RyaW5nIHtcbiAgY29uc3QgZmlyc3QgPSBvcmRlcmVkUGFnZXMobG9jYWxlLCBjb2xsZWN0aW9uKVswXVxuICBpZiAoZmlyc3QgPT09IHVuZGVmaW5lZCkgdGhyb3cgbmV3IEVycm9yKGBTaWRlYmFyIGNvbGxlY3Rpb24gXCIke2NvbGxlY3Rpb259XCIgcHVibGlzaGVzIG5vIHBhZ2UuYClcbiAgcmV0dXJuIHJvdXRlTGluayhmaXJzdC5yb3V0ZSlcbn1cbiIsICJjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfZGlybmFtZSA9IFwiRTpcXFxcTWl4XFxcXHByb2plY3RcXFxcZGVlcHNlZWstaGFybmVzc1xcXFwud29ya3RyZWVzXFxcXHVwc3RyZWFtLWZpcnN0XFxcXHNjcmlwdHNcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfZmlsZW5hbWUgPSBcIkU6XFxcXE1peFxcXFxwcm9qZWN0XFxcXGRlZXBzZWVrLWhhcm5lc3NcXFxcLndvcmt0cmVlc1xcXFx1cHN0cmVhbS1maXJzdFxcXFxzY3JpcHRzXFxcXHByb2plY3QtZG9jLXNpdGUudHNcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfaW1wb3J0X21ldGFfdXJsID0gXCJmaWxlOi8vL0U6L01peC9wcm9qZWN0L2RlZXBzZWVrLWhhcm5lc3MvLndvcmt0cmVlcy91cHN0cmVhbS1maXJzdC9zY3JpcHRzL3Byb2plY3QtZG9jLXNpdGUudHNcIjsvKipcbiAqIEJ1aWxkLXRpbWUgcHJvamVjdGlvbiBmcm9tIGNhbm9uaWNhbCByZXBvc2l0b3J5IE1hcmtkb3duIGludG8gVml0ZVByZXNzLlxuICpcbiAqIFRoZSBnZW5lcmF0ZWQgdHJlZSBpcyBkaXNwb3NhYmxlOiBzb3VyY2VzIHN0YXkgaW4gdGhlaXIgb3duaW5nIGBkb2NzL2BcbiAqIHRpZXIsIHdoaWxlIHRoaXMgYWRhcHRlciByZXdyaXRlcyBjcm9zcy1zb3VyY2UgbGlua3MgZm9yIHRoZSBwdWJsaWMgc2l0ZS5cbiAqIFRoZSBzYW1lIHByb2plY3Rpb24gYWxzbyBlbWl0cyBhIHJhdy1NYXJrZG93biB0d2luIG9mIGV2ZXJ5IHJvdXRlIGludG8gdGhlXG4gKiBidWlsZCBvdXRwdXQsIHNvIGEgcGFnZSdzIFVSTCwgbWludXMgYW55IHRyYWlsaW5nIHNsYXNoLCBwbHVzIGAubWRgIHNlcnZlc1xuICogaXQgYXMgcGxhaW4gTWFya2Rvd24uXG4gKi9cblxuaW1wb3J0IHtcbiAgY29weUZpbGVTeW5jLCBleGlzdHNTeW5jLCBsc3RhdFN5bmMsIG1rZGlyU3luYywgcmVhZEZpbGVTeW5jLCByZWFscGF0aFN5bmMsIHJtU3luYywgc3RhdFN5bmMsIHdyaXRlRmlsZVN5bmMsXG59IGZyb20gJ25vZGU6ZnMnXG5pbXBvcnQgeyBiYXNlbmFtZSwgZGlybmFtZSwgZXh0bmFtZSwgcG9zaXgsIHJlbGF0aXZlLCByZXNvbHZlLCBzZXAgfSBmcm9tICdub2RlOnBhdGgnXG5pbXBvcnQgeyBmcm9tTWFya2Rvd24gfSBmcm9tICdtZGFzdC11dGlsLWZyb20tbWFya2Rvd24nXG5pbXBvcnQgeyBnZm1Gcm9tTWFya2Rvd24gfSBmcm9tICdtZGFzdC11dGlsLWdmbSdcbmltcG9ydCB7IGdmbSB9IGZyb20gJ21pY3JvbWFyay1leHRlbnNpb24tZ2ZtJ1xuaW1wb3J0IHR5cGUgeyBOb2RlcyB9IGZyb20gJ21kYXN0J1xuaW1wb3J0IHsgZG9jc1BhZ2VzLCBsb2NhbGVDb2xsZWN0aW9ucywgb3JkZXJlZFBhZ2VzLCB0eXBlIERvY3NMb2NhbGUsIHR5cGUgRG9jc1BhZ2UgfSBmcm9tICcuLi93ZWJzaXRlL2RvY3MudHMnXG5pbXBvcnQge1xuICBpc0V4dGVybmFsT3JBYnNvbHV0ZU1hcmtkb3duVXJsLFxuICBtYXJrZG93bkRlc3RpbmF0aW9uLFxuICBzcGxpdE1hcmtkb3duVXJsVGFyZ2V0LFxufSBmcm9tICcuL21hcmtkb3duLnRzJ1xuXG5jb25zdCBSRVBPU0lUT1JZX1VSTCA9ICdodHRwczovL2dpdGh1Yi5jb20vZGVlcHNlZWstYWkvZGVlcHNlZWstaGFybmVzcydcbmNvbnN0IHJvb3QgPSByZXNvbHZlKGltcG9ydC5tZXRhLmRpcm5hbWUsICcuLicpXG5jb25zdCBnZW5lcmF0ZWRSb290ID0gcmVzb2x2ZShyb290LCAnd2Vic2l0ZS8uZ2VuZXJhdGVkJylcblxuLyoqXG4gKiBSZXNvbHZlIHRoZSBwdWJsaWMgcmVwb3NpdG9yeSByZWYgdXNlZCBieSBwcm9qZWN0ZWQgc291cmNlIGxpbmtzLlxuICpcbiAqIEBwYXJhbSBlbnZpcm9ubWVudCBCdWlsZCBlbnZpcm9ubWVudCBjb250YWluaW5nIGFuIG9wdGlvbmFsIGV4cGxpY2l0IHB1YmxpYyByZWYuXG4gKiBAcmV0dXJucyBUaGUgY29uZmlndXJlZCBwdWJsaWMgcmVmLCBvciBgbWFzdGVyYC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlc29sdmVSZXBvc2l0b3J5UmVmKGVudmlyb25tZW50OiBOb2RlSlMuUHJvY2Vzc0Vudik6IHN0cmluZyB7XG4gIHJldHVybiBlbnZpcm9ubWVudC5ET0NTX1JFUE9TSVRPUllfUkVGID8/ICdtYXN0ZXInXG59XG5cbmludGVyZmFjZSBSZXBsYWNlbWVudCB7XG4gIHN0YXJ0OiBudW1iZXJcbiAgZW5kOiBudW1iZXJcbiAgdmFsdWU6IHN0cmluZ1xufVxuXG50eXBlIFJld3JpdGFibGVOb2RlID0gRXh0cmFjdDxOb2RlcywgeyB0eXBlOiAnbGluaycgfCAnaW1hZ2UnIHwgJ2RlZmluaXRpb24nIH0+XG5cbi8qKiBJbnB1dHMgZm9yIHJld3JpdGluZyBvbmUgY2Fub25pY2FsIE1hcmtkb3duIHBhZ2UuICovXG5leHBvcnQgaW50ZXJmYWNlIFJld3JpdGVNYXJrZG93bk9wdGlvbnMge1xuICBsb2NhbGU6IERvY3NMb2NhbGVcbiAgc291cmNlUGF0aDogc3RyaW5nXG4gIHJvdXRlOiBzdHJpbmdcbiAgcGFnZXM6IERvY3NQYWdlW11cbiAgcmVwb1Jvb3Q6IHN0cmluZ1xuICByZXBvc2l0b3J5UmVmOiBzdHJpbmdcbiAgLyoqXG4gICAqIFBsYWNlIG9uZSByZWZlcmVuY2VkIGltYWdlIGJlc2lkZSB0aGUgcHJvamVjdGVkIHBhZ2UgYW5kIHJldHVybiB0aGUgVVJMIHRvXG4gICAqIHJlYWNoIGl0IGZyb20gdGhhdCBwYWdlLiBBIEdpdEh1YiByYXcgVVJMIGNhbm5vdCBzZXJ2ZSB0aGlzIHJlcG9zaXRvcnkgXHUyMDE0XG4gICAqIGByYXcuZ2l0aHVidXNlcmNvbnRlbnQuY29tYCBhbnN3ZXJzIDQwNCBmb3IgYSBwcml2YXRlIG9uZSwgYW5kIG5vIHJlYWRlciBvZlxuICAgKiB0aGUgc2l0ZSBpcyBhdXRoZW50aWNhdGVkIHRvIGl0IFx1MjAxNCBzbyBhbiBpbWFnZSB0cmF2ZWxzIGludG8gdGhlIGdlbmVyYXRlZFxuICAgKiB0cmVlIGFuZCBWaXRlIGJ1bmRsZXMgaXQgbGlrZSBhbnkgb3RoZXIgc2l0ZSBhc3NldC4gT21pdHRlZCBieSBjYWxsZXJzIHRoYXRcbiAgICogb25seSByZXdyaXRlIHRleHQsIHdoaWNoIHRoZW4gbGVhdmUgaW1hZ2VzIHBvaW50aW5nIGF0IHRoZSByZXBvc2l0b3J5LlxuICAgKi9cbiAgcGxhY2VJbWFnZT86IChhYnNQYXRoOiBzdHJpbmcpID0+IHN0cmluZ1xufVxuXG5mdW5jdGlvbiByZXBvUGF0aChhYnNQYXRoOiBzdHJpbmcsIHJlcG9Sb290OiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gcmVsYXRpdmUocmVwb1Jvb3QsIGFic1BhdGgpLnNwbGl0KHNlcCkuam9pbignLycpXG59XG5cbi8vIGAjZnJhZ21lbnRgIHN1ZmZpeGVzIHBhc3MgdGhyb3VnaCB2ZXJiYXRpbS4gR2VuZXJhdGVkIGNvcmRpcy1zdXJmYWNlXG4vLyBoZWFkaW5ncyBjYXJyeSBleHBsaWNpdCBgPGEgaWQ+YCBhbmNob3JzIHdpdGggdGhlIEdpdEh1YiBzbHVnLCBzbyB0aG9zZVxuLy8gZnJhZ21lbnRzIHJlc29sdmUgb24gdGhlIHB1Ymxpc2hlZCBzaXRlIHRvbzsgaGFuZC13cml0dGVuIGhlYWRpbmdzIHJlbHkgb25cbi8vIFZpdGVQcmVzcydzIG93biBzbHVnZ2VyLCB3aGljaCBkaWZmZXJzIGZyb20gR2l0SHViJ3MgZm9yIHB1bmN0dWF0aW9uLWhlYXZ5XG4vLyB0ZXh0IFx1MjAxNCBoYW5kLWF1dGhvcmVkIGNyb3NzLXBhZ2UgZnJhZ21lbnRzIHNob3VsZCBwcmVmZXIgcGxhaW4tdGV4dCBoZWFkaW5nc1xuLy8gb3IgZXhwbGljaXQgYW5jaG9ycy5cbmZ1bmN0aW9uIGRlY29kZVBhdGgocGF0aDogc3RyaW5nKTogc3RyaW5nIHtcbiAgdHJ5IHtcbiAgICByZXR1cm4gZGVjb2RlVVJJQ29tcG9uZW50KHBhdGgpXG4gIH0gY2F0Y2gge1xuICAgIHRocm93IG5ldyBFcnJvcihgcHJvamVjdC1kb2Mtc2l0ZTogbWFsZm9ybWVkIHBlcmNlbnQgZXNjYXBlIGluICR7SlNPTi5zdHJpbmdpZnkocGF0aCl9LmApXG4gIH1cbn1cblxuZnVuY3Rpb24gcm91dGVUYXJnZXQoZnJvbVJvdXRlOiBzdHJpbmcsIHRvUm91dGU6IHN0cmluZywgc3VmZml4OiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCB0YXJnZXQgPSBwb3NpeC5yZWxhdGl2ZShwb3NpeC5kaXJuYW1lKGZyb21Sb3V0ZSksIHRvUm91dGUpXG4gIHJldHVybiBgJHt0YXJnZXQuc3RhcnRzV2l0aCgnLicpID8gdGFyZ2V0IDogYC4vJHt0YXJnZXR9YH0ke3N1ZmZpeH1gXG59XG5cbmZ1bmN0aW9uIHNvdXJjZU1hcChwYWdlczogRG9jc1BhZ2VbXSk6IE1hcDxzdHJpbmcsIE1hcDxEb2NzTG9jYWxlLCBEb2NzUGFnZT4+IHtcbiAgY29uc3QgbWFwID0gbmV3IE1hcDxzdHJpbmcsIE1hcDxEb2NzTG9jYWxlLCBEb2NzUGFnZT4+KClcbiAgZm9yIChjb25zdCBwYWdlIG9mIHBhZ2VzKSB7XG4gICAgZm9yIChjb25zdCBzb3VyY2Ugb2YgW3BhZ2Uuc291cmNlLCAuLi4ocGFnZS5zb3VyY2VBbGlhc2VzID8/IFtdKV0pIHtcbiAgICAgIGNvbnN0IGxvY2FsaXplZCA9IG1hcC5nZXQoc291cmNlKSA/PyBuZXcgTWFwPERvY3NMb2NhbGUsIERvY3NQYWdlPigpXG4gICAgICBpZiAobG9jYWxpemVkLmhhcyhwYWdlLmxvY2FsZSkpIHtcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBwcm9qZWN0LWRvYy1zaXRlOiBkdXBsaWNhdGUgc291cmNlIG9yIGFsaWFzICR7SlNPTi5zdHJpbmdpZnkoc291cmNlKX0gZm9yIGxvY2FsZSAke0pTT04uc3RyaW5naWZ5KHBhZ2UubG9jYWxlKX0uYClcbiAgICAgIH1cbiAgICAgIGxvY2FsaXplZC5zZXQocGFnZS5sb2NhbGUsIHBhZ2UpXG4gICAgICBtYXAuc2V0KHNvdXJjZSwgbG9jYWxpemVkKVxuICAgIH1cbiAgfVxuICByZXR1cm4gbWFwXG59XG5cbmZ1bmN0aW9uIGNvdW50ZXJwYXJ0U291cmNlKHNvdXJjZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIHNvdXJjZS5lbmRzV2l0aCgnLnpoLm1kJylcbiAgICA/IHNvdXJjZS5yZXBsYWNlKC9cXC56aFxcLm1kJC8sICcubWQnKVxuICAgIDogc291cmNlLnJlcGxhY2UoL1xcLm1kJC8sICcuemgubWQnKVxufVxuXG5mdW5jdGlvbiByZXNvbHZlUmVwb3NpdG9yeVRhcmdldChzb3VyY2VBYnM6IHN0cmluZywgcmF3UGF0aDogc3RyaW5nLCByZXBvUm9vdDogc3RyaW5nKTogeyBhYnNQYXRoOiBzdHJpbmc7IGxpbmU/OiBudW1iZXIgfSB7XG4gIGNvbnN0IGRlY29kZWQgPSBkZWNvZGVQYXRoKHJhd1BhdGgpXG4gIGxldCBhYnNQYXRoID0gcmVzb2x2ZShkaXJuYW1lKHNvdXJjZUFicyksIGRlY29kZWQpXG4gIGlmIChleGlzdHNTeW5jKGFic1BhdGgpKSByZXR1cm4geyBhYnNQYXRoIH1cblxuICBjb25zdCBsaW5lTWF0Y2ggPSBkZWNvZGVkLm1hdGNoKC86KFxcZCspJC8pXG4gIGlmIChsaW5lTWF0Y2ggIT09IG51bGwpIHtcbiAgICBjb25zdCBsaW5lVGV4dCA9IGxpbmVNYXRjaFsxXVxuICAgIGlmIChsaW5lVGV4dCA9PT0gdW5kZWZpbmVkKSB0aHJvdyBuZXcgRXJyb3IoJ3Byb2plY3QtZG9jLXNpdGU6IGxpbmUgc3VmZml4IG1hdGNoZWQgd2l0aG91dCBhIGxpbmUgbnVtYmVyLicpXG4gICAgYWJzUGF0aCA9IHJlc29sdmUoZGlybmFtZShzb3VyY2VBYnMpLCBkZWNvZGVkLnNsaWNlKDAsIC1saW5lTWF0Y2hbMF0ubGVuZ3RoKSlcbiAgICBpZiAoZXhpc3RzU3luYyhhYnNQYXRoKSkgcmV0dXJuIHsgYWJzUGF0aCwgbGluZTogTnVtYmVyLnBhcnNlSW50KGxpbmVUZXh0LCAxMCkgfVxuICB9XG5cbiAgaWYgKGV4dG5hbWUoZGVjb2RlZCkgPT09ICcnKSB7XG4gICAgY29uc3QgbWFya2Rvd24gPSByZXNvbHZlKGRpcm5hbWUoc291cmNlQWJzKSwgYCR7ZGVjb2RlZH0ubWRgKVxuICAgIGlmIChleGlzdHNTeW5jKG1hcmtkb3duKSkgcmV0dXJuIHsgYWJzUGF0aDogbWFya2Rvd24gfVxuICAgIGNvbnN0IGluZGV4ID0gcmVzb2x2ZShkaXJuYW1lKHNvdXJjZUFicyksIGRlY29kZWQsICdpbmRleC5tZCcpXG4gICAgaWYgKGV4aXN0c1N5bmMoaW5kZXgpKSByZXR1cm4geyBhYnNQYXRoOiBpbmRleCB9XG4gIH1cblxuICB0aHJvdyBuZXcgRXJyb3IoYHByb2plY3QtZG9jLXNpdGU6ICR7cmVwb1BhdGgoc291cmNlQWJzLCByZXBvUm9vdCl9IGxpbmtzIHRvIG1pc3NpbmcgcGF0aCAke0pTT04uc3RyaW5naWZ5KHJhd1BhdGgpfS5gKVxufVxuXG5mdW5jdGlvbiBnaXRodWJUYXJnZXQoXG4gIGFic1BhdGg6IHN0cmluZyxcbiAgbGluZTogbnVtYmVyIHwgdW5kZWZpbmVkLFxuICBzdWZmaXg6IHN0cmluZyxcbiAgcmVwb3NpdG9yeVJlZjogc3RyaW5nLFxuICByZXBvUm9vdDogc3RyaW5nLFxuICBpbWFnZTogYm9vbGVhbixcbik6IHN0cmluZyB7XG4gIGNvbnN0IHBhdGggPSByZXBvUGF0aChhYnNQYXRoLCByZXBvUm9vdClcbiAgaWYgKGltYWdlKSByZXR1cm4gYGh0dHBzOi8vcmF3LmdpdGh1YnVzZXJjb250ZW50LmNvbS9kZWVwc2Vlay1haS9kZWVwc2Vlay1oYXJuZXNzLyR7cmVwb3NpdG9yeVJlZn0vJHtwYXRofSR7c3VmZml4fWBcbiAgY29uc3Qga2luZCA9IGxzdGF0U3luYyhhYnNQYXRoKS5pc0RpcmVjdG9yeSgpID8gJ3RyZWUnIDogJ2Jsb2InXG4gIGNvbnN0IGxpbmVTdWZmaXggPSBsaW5lID09PSB1bmRlZmluZWQgPyBzdWZmaXggOiBgI0wke2xpbmV9YFxuICByZXR1cm4gYCR7UkVQT1NJVE9SWV9VUkx9LyR7a2luZH0vJHtyZXBvc2l0b3J5UmVmfS8ke3BhdGh9JHtsaW5lU3VmZml4fWBcbn1cblxuLyoqXG4gKiBSZXdyaXRlIHJlcG9zaXRvcnktcmVsYXRpdmUgbGlua3Mgd2l0aG91dCByZXNlcmlhbGl6aW5nIE1hcmtkb3duLlxuICpcbiAqIEBwYXJhbSBzb3VyY2UgTWFya2Rvd24gdGV4dCBmcm9tIHRoZSBjYW5vbmljYWwgZmlsZS5cbiAqIEBwYXJhbSBvcHRpb25zIFNvdXJjZSwgcm91dGUsIG1hbmlmZXN0LCBhbmQgcmVwb3NpdG9yeSBjb250ZXh0LlxuICogQHJldHVybnMgTWFya2Rvd24gd2hvc2UgcHVibGlzaGVkIGxpbmtzIHJlc29sdmUgaW5zaWRlIHRoZSBzaXRlIG9yIHRvIEdpdEh1Yi5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJld3JpdGVNYXJrZG93bihzb3VyY2U6IHN0cmluZywgb3B0aW9uczogUmV3cml0ZU1hcmtkb3duT3B0aW9ucyk6IHN0cmluZyB7XG4gIGNvbnN0IHNvdXJjZUFicyA9IHJlc29sdmUob3B0aW9ucy5yZXBvUm9vdCwgb3B0aW9ucy5zb3VyY2VQYXRoKVxuICBjb25zdCBwdWJsaXNoZWQgPSBzb3VyY2VNYXAob3B0aW9ucy5wYWdlcylcbiAgY29uc3QgdHJlZSA9IGZyb21NYXJrZG93bihzb3VyY2UsIHsgZXh0ZW5zaW9uczogW2dmbSgpXSwgbWRhc3RFeHRlbnNpb25zOiBbZ2ZtRnJvbU1hcmtkb3duKCldIH0pXG4gIGNvbnN0IHJlcGxhY2VtZW50czogUmVwbGFjZW1lbnRbXSA9IFtdXG5cbiAgY29uc3QgcmV3cml0ZSA9IChub2RlOiBSZXdyaXRhYmxlTm9kZSk6IHZvaWQgPT4ge1xuICAgIGlmIChpc0V4dGVybmFsT3JBYnNvbHV0ZU1hcmtkb3duVXJsKG5vZGUudXJsKSkgcmV0dXJuXG4gICAgY29uc3QgeyBwYXRoLCBzdWZmaXggfSA9IHNwbGl0TWFya2Rvd25VcmxUYXJnZXQobm9kZS51cmwpXG4gICAgaWYgKHBhdGggPT09ICcnKSByZXR1cm5cbiAgICBjb25zdCB7IGFic1BhdGgsIGxpbmUgfSA9IHJlc29sdmVSZXBvc2l0b3J5VGFyZ2V0KHNvdXJjZUFicywgcGF0aCwgb3B0aW9ucy5yZXBvUm9vdClcbiAgICBjb25zdCB0YXJnZXRQYXRoID0gcmVwb1BhdGgoYWJzUGF0aCwgb3B0aW9ucy5yZXBvUm9vdClcbiAgICBjb25zdCBpc0xhbmd1YWdlU3dpdGNoZXIgPSB0YXJnZXRQYXRoID09PSBjb3VudGVycGFydFNvdXJjZShvcHRpb25zLnNvdXJjZVBhdGgpXG4gICAgY29uc3QgdGFyZ2V0TG9jYWxlOiBEb2NzTG9jYWxlID0gaXNMYW5ndWFnZVN3aXRjaGVyXG4gICAgICA/IG9wdGlvbnMubG9jYWxlID09PSAncm9vdCcgPyAnZW4nIDogJ3Jvb3QnXG4gICAgICA6IG9wdGlvbnMubG9jYWxlXG4gICAgY29uc3QgcGFnZSA9IHB1Ymxpc2hlZC5nZXQodGFyZ2V0UGF0aCk/LmdldCh0YXJnZXRMb2NhbGUpXG4gICAgY29uc3QgbmV4dFVybCA9IHBhZ2UgIT09IHVuZGVmaW5lZFxuICAgICAgPyByb3V0ZVRhcmdldChvcHRpb25zLnJvdXRlLCBwYWdlLnJvdXRlLCBzdWZmaXgpXG4gICAgICA6IG5vZGUudHlwZSA9PT0gJ2ltYWdlJyAmJiBvcHRpb25zLnBsYWNlSW1hZ2UgIT09IHVuZGVmaW5lZFxuICAgICAgICAvLyBUaGUgc3VmZml4IHJpZGVzIGFsb25nIGV4YWN0bHkgYXMgdGhlIEdpdEh1YiBicmFuY2gga2VlcHMgaXQ6IGFuIFNWR1xuICAgICAgICAvLyB2aWV3IGZyYWdtZW50IG9yIGEgVml0ZSBxdWVyeSBjaGFuZ2VzIHdoYXQgdGhlIHJlZmVyZW5jZSBtZWFucy5cbiAgICAgICAgPyBgJHtvcHRpb25zLnBsYWNlSW1hZ2UoYWJzUGF0aCl9JHtzdWZmaXh9YFxuICAgICAgICA6IGdpdGh1YlRhcmdldChhYnNQYXRoLCBsaW5lLCBzdWZmaXgsIG9wdGlvbnMucmVwb3NpdG9yeVJlZiwgb3B0aW9ucy5yZXBvUm9vdCwgbm9kZS50eXBlID09PSAnaW1hZ2UnKVxuXG4gICAgY29uc3QgZGVzdGluYXRpb24gPSBtYXJrZG93bkRlc3RpbmF0aW9uKHNvdXJjZSwgbm9kZSlcbiAgICByZXBsYWNlbWVudHMucHVzaCh7XG4gICAgICBzdGFydDogZGVzdGluYXRpb24uc3RhcnQsXG4gICAgICBlbmQ6IGRlc3RpbmF0aW9uLmVuZCxcbiAgICAgIHZhbHVlOiBuZXh0VXJsLFxuICAgIH0pXG4gIH1cblxuICBjb25zdCB2aXNpdCA9IChub2RlOiBOb2Rlcyk6IHZvaWQgPT4ge1xuICAgIGlmICgobm9kZS50eXBlID09PSAnbGluaycgfHwgbm9kZS50eXBlID09PSAnaW1hZ2UnIHx8IG5vZGUudHlwZSA9PT0gJ2RlZmluaXRpb24nKSAmJiAndXJsJyBpbiBub2RlKSByZXdyaXRlKG5vZGUpXG4gICAgaWYgKCdjaGlsZHJlbicgaW4gbm9kZSkge1xuICAgICAgZm9yIChjb25zdCBjaGlsZCBvZiBub2RlLmNoaWxkcmVuKSB2aXNpdChjaGlsZClcbiAgICB9XG4gIH1cbiAgdmlzaXQodHJlZSlcblxuICBsZXQgcHJvamVjdGVkID0gc291cmNlXG4gIGZvciAoY29uc3QgcmVwbGFjZW1lbnQgb2YgcmVwbGFjZW1lbnRzLnNvcnQoKGEsIGIpID0+IGIuc3RhcnQgLSBhLnN0YXJ0KSkge1xuICAgIHByb2plY3RlZCA9IHByb2plY3RlZC5zbGljZSgwLCByZXBsYWNlbWVudC5zdGFydCkgKyByZXBsYWNlbWVudC52YWx1ZSArIHByb2plY3RlZC5zbGljZShyZXBsYWNlbWVudC5lbmQpXG4gIH1cbiAgcmV0dXJuIHByb2plY3RlZFxufVxuXG4vKipcbiAqIFJlY29yZCB0aGUgY2Fub25pY2FsIGVkaXQgdGFyZ2V0IGluIFZpdGVQcmVzcyBmcm9udG1hdHRlci5cbiAqXG4gKiBAcGFyYW0gbWFya2Rvd24gUHJvamVjdGVkIE1hcmtkb3duIGNvbnRlbnQuXG4gKiBAcGFyYW0gcGFnZSBQdWJsaWNhdGlvbiBtYW5pZmVzdCBlbnRyeSBmb3IgdGhlIGNvbnRlbnQuXG4gKiBAcmV0dXJucyBNYXJrZG93biB3aXRoIHByb2plY3Rpb24tb3duZWQgZnJvbnRtYXR0ZXIgZmllbGRzLlxuICovXG5leHBvcnQgZnVuY3Rpb24gYWRkUHJvamVjdGlvbkZyb250bWF0dGVyKG1hcmtkb3duOiBzdHJpbmcsIHBhZ2U6IFBpY2s8RG9jc1BhZ2UsICdzb3VyY2UnIHwgJ291dGxpbmUnPik6IHN0cmluZyB7XG4gIGNvbnN0IGZpZWxkcyA9IFtcbiAgICBgZWRpdFNvdXJjZTogJHtKU09OLnN0cmluZ2lmeShwYWdlLnNvdXJjZSl9YCxcbiAgICAuLi4ocGFnZS5vdXRsaW5lID09PSB1bmRlZmluZWQgPyBbXSA6IFtgb3V0bGluZTogJHtKU09OLnN0cmluZ2lmeShwYWdlLm91dGxpbmUpfWBdKSxcbiAgXS5qb2luKCdcXG4nKVxuICBpZiAobWFya2Rvd24uc3RhcnRzV2l0aCgnLS0tXFxuJykpIHJldHVybiBtYXJrZG93bi5yZXBsYWNlKCctLS1cXG4nLCBgLS0tXFxuJHtmaWVsZHN9XFxuYClcbiAgcmV0dXJuIGAtLS1cXG4ke2ZpZWxkc31cXG4tLS1cXG5cXG4ke21hcmtkb3dufWBcbn1cblxuLyoqIFRoZSBzd2l0Y2hlciBsaW5lIGEgY2Fub25pY2FsIHBhZ2UgY2FycmllcyBzbyBpdHMgR2l0SHViIHJlYWRlciBjYW4gcmVhY2ggdGhlIG90aGVyIGxhbmd1YWdlLiAqL1xuY29uc3QgTEFOR1VBR0VfU1dJVENIRVIgPSAvXig/OkVuZ2xpc2ggXFx8IFxcW1x1NEUyRFx1NjU4N1xcXVxcKFteKV0qXFwpfFxcW0VuZ2xpc2hcXF1cXChbXildKlxcKSBcXHwgXHU0RTJEXHU2NTg3KSQvXG5cbi8qKiBUaGUgcmVwb3NpdG9yeSBiYWRnZSBhIGNhbm9uaWNhbCBwYWdlIGNhcnJpZXMgZm9yIGl0cyBHaXRIdWIgcmVhZGVyLiAqL1xuY29uc3QgUkVQT1NJVE9SWV9CQURHRSA9IC9eXFxbIVxcW1teXFxdXSpcXF1cXChodHRwczpcXC9cXC9pbWdcXC5zaGllbGRzXFwuaW9cXC9bXildKlxcKVxcXVxcKFteKV0qXFwpJC9cblxuLyoqXG4gKiBEcm9wIHRoZSBsaW5lcyB0aGF0IGFkZHJlc3MgYSBjYW5vbmljYWwgcGFnZSdzIEdpdEh1YiByZWFkZXIuXG4gKlxuICogVGhlIHNpdGUgY2FycmllcyBhIGxvY2FsZSBzd2l0Y2hlciBpbiBpdHMgbmF2aWdhdGlvbiBiYXIgYW5kIGxpbmtzIHRoZVxuICogcmVwb3NpdG9yeSBmcm9tIGV2ZXJ5IHBhZ2UsIHNvIHByb2plY3RpbmcgdGhlc2UgbGluZXMgd291bGQgcmVwZWF0IGJvdGggXHUyMDE0IHRoZVxuICogc3dpdGNoZXIgYXMgdGhlIGZpcnN0IGVsZW1lbnQgdW5kZXIgZWFjaCBoZWFkaW5nLlxuICpcbiAqIEBwYXJhbSBtYXJrZG93biBSZXdyaXR0ZW4gY2Fub25pY2FsIE1hcmtkb3duIGNvbnRlbnQuXG4gKiBAcmV0dXJucyBUaGUgY29udGVudCB3aXRob3V0IHRoZSBzd2l0Y2hlciBsaW5lIG9yIHRoZSByZXBvc2l0b3J5IGJhZGdlLlxuICovXG5mdW5jdGlvbiB3aXRob3V0UmVwb3NpdG9yeUNocm9tZShtYXJrZG93bjogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3QgbGluZXMgPSBtYXJrZG93bi5zcGxpdCgnXFxuJylcbiAgY29uc3Qgc3dpdGNoZXIgPSBsaW5lcy5maW5kSW5kZXgobGluZSA9PiBMQU5HVUFHRV9TV0lUQ0hFUi50ZXN0KGxpbmUpKVxuICAvLyBPbmx5IHRoZSBzd2l0Y2hlciBpbnRyb2R1Y2luZyB0aGUgcGFnZSBxdWFsaWZpZXM7IGZ1cnRoZXIgZG93biB0aGUgc2FtZVxuICAvLyB0ZXh0IGlzIHByb3NlIG9yIGEgc2FtcGxlIHJhdGhlciB0aGFuIHRoZSBwYWdlJ3Mgb3duIGhlYWRlci5cbiAgaWYgKHN3aXRjaGVyICE9PSAtMSAmJiBzd2l0Y2hlciA8IDgpIHtcbiAgICBsaW5lcy5zcGxpY2Uoc3dpdGNoZXIsIGxpbmVzW3N3aXRjaGVyICsgMV0gPT09ICcnID8gMiA6IDEpXG4gIH1cbiAgY29uc3QgYmFkZ2UgPSBsaW5lcy5maW5kTGFzdEluZGV4KGxpbmUgPT4gUkVQT1NJVE9SWV9CQURHRS50ZXN0KGxpbmUpKVxuICBpZiAoYmFkZ2UgIT09IC0xKSB7XG4gICAgbGluZXMuc3BsaWNlKGxpbmVzW2JhZGdlIC0gMV0gPT09ICcnID8gYmFkZ2UgLSAxIDogYmFkZ2UsIGxpbmVzW2JhZGdlIC0gMV0gPT09ICcnID8gMiA6IDEpXG4gIH1cbiAgcmV0dXJuIGxpbmVzLmpvaW4oJ1xcbicpXG59XG5cbi8qKlxuICogU2VsZWN0IHRoZSBNYXJrZG93biByZW5kZXJlZCBmb3Igb25lIHB1Ymxpc2hlZCBwYWdlLlxuICpcbiAqIEBwYXJhbSBtYXJrZG93biBSZXdyaXR0ZW4gY2Fub25pY2FsIE1hcmtkb3duIGNvbnRlbnQuXG4gKiBAcGFyYW0gcGFnZSBQdWJsaWNhdGlvbiBtYW5pZmVzdCBlbnRyeSBmb3IgdGhlIGNvbnRlbnQuXG4gKiBAcmV0dXJucyBGdWxsIE1hcmtkb3duIGZvciBvcmRpbmFyeSBwYWdlcyBvciBmcm9udG1hdHRlci1vbmx5IE1hcmtkb3duIGZvciBhIGxvY2FsZSBob21lIHBhZ2UuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwcm9qZWN0ZWRQYWdlQ29udGVudChtYXJrZG93bjogc3RyaW5nLCBwYWdlOiBEb2NzUGFnZSk6IHN0cmluZyB7XG4gIGlmIChwYWdlLnNpZGViYXIgIT09IG51bGwpIHJldHVybiB3aXRob3V0UmVwb3NpdG9yeUNocm9tZShtYXJrZG93bilcbiAgaWYgKCFtYXJrZG93bi5zdGFydHNXaXRoKCctLS1cXG4nKSkge1xuICAgIHRocm93IG5ldyBFcnJvcihgcHJvamVjdC1kb2Mtc2l0ZTogbG9jYWxlIGhvbWUgc291cmNlICR7SlNPTi5zdHJpbmdpZnkocGFnZS5zb3VyY2UpfSBtdXN0IHN0YXJ0IHdpdGggWUFNTCBmcm9udG1hdHRlci5gKVxuICB9XG4gIGNvbnN0IGNsb3NpbmdEZWxpbWl0ZXIgPSAnXFxuLS0tXFxuJ1xuICBjb25zdCBjbG9zaW5nID0gbWFya2Rvd24uaW5kZXhPZihjbG9zaW5nRGVsaW1pdGVyLCA0KVxuICBpZiAoY2xvc2luZyA9PT0gLTEpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoYHByb2plY3QtZG9jLXNpdGU6IGxvY2FsZSBob21lIHNvdXJjZSAke0pTT04uc3RyaW5naWZ5KHBhZ2Uuc291cmNlKX0gaGFzIHVuY2xvc2VkIFlBTUwgZnJvbnRtYXR0ZXIuYClcbiAgfVxuICByZXR1cm4gbWFya2Rvd24uc2xpY2UoMCwgY2xvc2luZyArIGNsb3NpbmdEZWxpbWl0ZXIubGVuZ3RoKVxufVxuXG4vKipcbiAqIFRoZSByZXBvc2l0b3J5IGZpbGUgb25lIGltYWdlIHJlZmVyZW5jZSByZXNvbHZlcyB0bywgb3IgYHVuZGVmaW5lZGAgd2hlbiB0aGVcbiAqIHRhcmdldCBpcyBub3QgYSBsb2NhbCBmaWxlIHRoaXMgYnVpbGQgbWF5IHB1Ymxpc2guXG4gKiBAcGFyYW0gYWJzUGF0aCAtIHJlc29sdmVkIGltYWdlIHRhcmdldC5cbiAqIEBwYXJhbSByZXBvUm9vdCAtIHJlcG9zaXRvcnkgcm9vdCBldmVyeSBwdWJsaXNoZWQgaW1hZ2UgbXVzdCBzdGF5IGluc2lkZS5cbiAqIEByZXR1cm5zIHRoZSBmaWxlJ3MgcmVhbCBwYXRoLCBvciBgdW5kZWZpbmVkYCB3aGVuIGl0IG11c3Qgbm90IGJlIGNvcGllZC5cbiAqXG4gKiBPbmx5IGEgcmVndWxhciBmaWxlIHdob3NlIHJlYWwgcGF0aCBzdGF5cyBpbnNpZGUgdGhlIHJlcG9zaXRvcnkgcXVhbGlmaWVzLlxuICogUHVibGljYXRpb24gY29waWVzIHRoZSBieXRlcyBpbnRvIHRoZSBzaXRlLCBzbyBhIHJlZmVyZW5jZSBlc2NhcGluZyB0aGVcbiAqIHJlcG9zaXRvcnkgXHUyMDE0IGAuLi8uLi8uc3NoL2lkX3JzYWAsIG9yIGEgc3ltbGluayBwb2ludGluZyBvdXQgb2YgdGhlIHRyZWUgXHUyMDE0XG4gKiB3b3VsZCBwdXQgYSBidWlsZC1tYWNoaW5lIGZpbGUgb24gdGhlIHNpdGU7IGBleGlzdHNTeW5jYCBhbG9uZSwgd2hpY2ggaXMgYWxsXG4gKiBsaW5rIHJlc29sdXRpb24gbmVlZHMsIGRvZXMgbm90IGFuc3dlciB0aGF0LlxuICovXG5leHBvcnQgZnVuY3Rpb24gcHVibGlzaGFibGVJbWFnZShhYnNQYXRoOiBzdHJpbmcsIHJlcG9Sb290OiBzdHJpbmcpOiBzdHJpbmcgfCB1bmRlZmluZWQge1xuICBjb25zdCByZWFsID0gcmVhbHBhdGhTeW5jKGFic1BhdGgpXG4gIGNvbnN0IGluc2lkZSA9IHJlYWwgPT09IHJlcG9Sb290IHx8IHJlYWwuc3RhcnRzV2l0aChgJHtyZXBvUm9vdH0ke3NlcH1gKVxuICByZXR1cm4gaW5zaWRlICYmIHN0YXRTeW5jKHJlYWwpLmlzRmlsZSgpID8gcmVhbCA6IHVuZGVmaW5lZFxufVxuXG4vKiogRXZlcnkgbG9jYWwgaW1hZ2UgYSBwdWJsaXNoZWQgcGFnZSByZWZlcmVuY2VzLCByZXNvbHZlZCB0byBpdHMgcmVwb3NpdG9yeSBmaWxlLiAqL1xuZnVuY3Rpb24gcmVmZXJlbmNlZEltYWdlcygpOiBzdHJpbmdbXSB7XG4gIGNvbnN0IGZvdW5kID0gbmV3IFNldDxzdHJpbmc+KClcbiAgZm9yIChjb25zdCBwYWdlIG9mIGRvY3NQYWdlcykge1xuICAgIGNvbnN0IHNvdXJjZUFicyA9IHJlc29sdmUocm9vdCwgcGFnZS5zb3VyY2UpXG4gICAgaWYgKCFleGlzdHNTeW5jKHNvdXJjZUFicykpIGNvbnRpbnVlXG4gICAgcmV3cml0ZU1hcmtkb3duKHJlYWRGaWxlU3luYyhzb3VyY2VBYnMsICd1dGY4JyksIHtcbiAgICAgIHNvdXJjZVBhdGg6IHBhZ2Uuc291cmNlLFxuICAgICAgbG9jYWxlOiBwYWdlLmxvY2FsZSxcbiAgICAgIHJvdXRlOiBwYWdlLnJvdXRlLFxuICAgICAgcGFnZXM6IGRvY3NQYWdlcyxcbiAgICAgIHJlcG9Sb290OiByb290LFxuICAgICAgcmVwb3NpdG9yeVJlZjogJ21hc3RlcicsXG4gICAgICBwbGFjZUltYWdlOiAoYWJzUGF0aCkgPT4ge1xuICAgICAgICBjb25zdCByZWFsID0gcHVibGlzaGFibGVJbWFnZShhYnNQYXRoLCByb290KVxuICAgICAgICBpZiAocmVhbCAhPT0gdW5kZWZpbmVkKSBmb3VuZC5hZGQocmVhbClcbiAgICAgICAgcmV0dXJuICcnXG4gICAgICB9LFxuICAgIH0pXG4gIH1cbiAgcmV0dXJuIFsuLi5mb3VuZF1cbn1cblxuLyoqXG4gKiBGaWxlcyB3YXRjaGVkIGJ5IHRoZSBsb2NhbCBWaXRlUHJlc3MgZGV2IHNlcnZlcjogZXZlcnkgY2Fub25pY2FsIE1hcmtkb3duXG4gKiBzb3VyY2UsIHBsdXMgdGhlIGltYWdlcyB0aGV5IHB1Ymxpc2guIFdpdGhvdXQgdGhlIGltYWdlcywgcmVwbGFjaW5nIGFcbiAqIHNjcmVlbnNob3QgbGVhdmVzIHRoZSBwcmV2aW91cyBjb3B5IGluIHRoZSBnZW5lcmF0ZWQgdHJlZSB1bnRpbCBzb21ldGhpbmdcbiAqIHRvdWNoZXMgdGhlIE1hcmtkb3duIGJlc2lkZSBpdC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGRvY3NTb3VyY2VGaWxlcygpOiBzdHJpbmdbXSB7XG4gIHJldHVybiBbLi4ubmV3IFNldChbLi4uZG9jc1BhZ2VzLm1hcChwYWdlID0+IHJlc29sdmUocm9vdCwgcGFnZS5zb3VyY2UpKSwgLi4ucmVmZXJlbmNlZEltYWdlcygpXSldXG59XG5cbi8qKiBNYW5pZmVzdCBhbmQgcmVwb3NpdG9yeSBpbnB1dHMgZm9yIG9uZSBwcm9qZWN0aW9uIHBhc3MuICovXG5leHBvcnQgaW50ZXJmYWNlIFByb2plY3Rpb25Db250ZXh0IHtcbiAgLyoqIFBhZ2VzIHRvIHByb2plY3QuICovXG4gIHBhZ2VzOiBEb2NzUGFnZVtdXG4gIC8qKiBSZXBvc2l0b3J5IHJvb3QgZXZlcnkgc291cmNlIGFuZCBwbGFjZWQgaW1hZ2UgbXVzdCBsaXZlIHVuZGVyLiAqL1xuICByZXBvUm9vdDogc3RyaW5nXG4gIC8qKiBQdWJsaWMgcmVmIHVzZWQgYnkgcHJvamVjdGVkIEdpdEh1YiBsaW5rcy4gKi9cbiAgcmVwb3NpdG9yeVJlZjogc3RyaW5nXG59XG5cbmZ1bmN0aW9uIGRlZmF1bHRQcm9qZWN0aW9uQ29udGV4dCgpOiBQcm9qZWN0aW9uQ29udGV4dCB7XG4gIHJldHVybiB7IHBhZ2VzOiBkb2NzUGFnZXMsIHJlcG9Sb290OiByb290LCByZXBvc2l0b3J5UmVmOiByZXNvbHZlUmVwb3NpdG9yeVJlZihwcm9jZXNzLmVudikgfVxufVxuXG4vKipcbiAqIFByb2plY3QgZXZlcnkgcGFnZSBhbmQgaXRzIGltYWdlcyBpbnRvIG9uZSB0YXJnZXQgdHJlZS5cbiAqXG4gKiBgZW50cmllc2AgYXJlIHdoYXQgZ2V0cyBlbWl0dGVkOyBsaW5rIHJlc29sdXRpb24gYWx3YXlzIHJlYWRzIHRoZSBjYW5vbmljYWxcbiAqIGBjb250ZXh0LnBhZ2VzYCwgc28gYW4gYWxpYXMgZW50cnkgc2hhcmluZyBhIHNvdXJjZSB3aXRoIGl0cyBpbmRleCByb3V0ZVxuICogZW1pdHMgYXQgaXRzIG93biBwYXRoIHdoaWxlIGxpbmtzIGtlZXAgdGFyZ2V0aW5nIGNhbm9uaWNhbCByb3V0ZXMuXG4gKi9cbmZ1bmN0aW9uIHByb2plY3RQYWdlc0ludG8oXG4gIHRhcmdldFJvb3Q6IHN0cmluZyxcbiAgY29udGV4dDogUHJvamVjdGlvbkNvbnRleHQsXG4gIHBhZ2VDb250ZW50OiAobWFya2Rvd246IHN0cmluZywgcGFnZTogRG9jc1BhZ2UpID0+IHN0cmluZyxcbiAgZW50cmllczogRG9jc1BhZ2VbXSA9IGNvbnRleHQucGFnZXMsXG4pOiB2b2lkIHtcbiAgY29uc3Qgcm91dGVzID0gbmV3IFNldDxzdHJpbmc+KClcbiAgLyoqIFByb2plY3RlZCBwYXRoIHRvIHRoZSByZXBvc2l0b3J5IGZpbGUgdGhhdCBjbGFpbWVkIGl0LCBwYWdlcyBhbmQgaW1hZ2VzIGFsaWtlLiAqL1xuICBjb25zdCBjbGFpbWVkID0gbmV3IE1hcDxzdHJpbmcsIHN0cmluZz4oKVxuXG4gIC8qKiBSZXNlcnZlIG9uZSBwcm9qZWN0ZWQgcGF0aCwgcmVmdXNpbmcgYSBzZWNvbmQgc291cmNlIGZvciBpdC4gKi9cbiAgY29uc3QgY2xhaW0gPSAodGFyZ2V0OiBzdHJpbmcsIHNvdXJjZUFiczogc3RyaW5nKTogdm9pZCA9PiB7XG4gICAgY29uc3QgaG9sZGVyID0gY2xhaW1lZC5nZXQodGFyZ2V0KVxuICAgIGlmIChob2xkZXIgIT09IHVuZGVmaW5lZCAmJiBob2xkZXIgIT09IHNvdXJjZUFicykge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgICBgcHJvamVjdC1kb2Mtc2l0ZTogJHtyZXBvUGF0aChzb3VyY2VBYnMsIGNvbnRleHQucmVwb1Jvb3QpfSBhbmQgJHtyZXBvUGF0aChob2xkZXIsIGNvbnRleHQucmVwb1Jvb3QpfWBcbiAgICAgICAgKyBgIGJvdGggcHJvamVjdCB0byAke3JlbGF0aXZlKHRhcmdldFJvb3QsIHRhcmdldCkuc3BsaXQoc2VwKS5qb2luKCcvJyl9LmAsXG4gICAgICApXG4gICAgfVxuICAgIC8vIEEgZmlsZSB0aGUgcHJvamVjdGlvbiBkaWQgbm90IGNsYWltIGlzIGFub3RoZXIgcHJvZHVjZXIncyBvdXRwdXQgXHUyMDE0IGluXG4gICAgLy8gdGhlIHR3aW4gcGFzcywgdGhlIGJ1aWxkIFZpdGVQcmVzcyBqdXN0IHdyb3RlLCBpbmNsdWRpbmcgYHB1YmxpYy9gXG4gICAgLy8gY29waWVzLiBPdmVyd3JpdGluZyBvbmUgd291bGQgc2lsZW50bHkgY29ycnVwdCB0aGUgc2l0ZS5cbiAgICBpZiAoaG9sZGVyID09PSB1bmRlZmluZWQgJiYgZXhpc3RzU3luYyh0YXJnZXQpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgIGBwcm9qZWN0LWRvYy1zaXRlOiAke3JlcG9QYXRoKHNvdXJjZUFicywgY29udGV4dC5yZXBvUm9vdCl9IHdvdWxkIG92ZXJ3cml0ZSBleGlzdGluZyBidWlsZCBmaWxlYFxuICAgICAgICArIGAgJHtyZWxhdGl2ZSh0YXJnZXRSb290LCB0YXJnZXQpLnNwbGl0KHNlcCkuam9pbignLycpfS5gLFxuICAgICAgKVxuICAgIH1cbiAgICBjbGFpbWVkLnNldCh0YXJnZXQsIHNvdXJjZUFicylcbiAgfVxuXG4gIGZvciAoY29uc3QgcGFnZSBvZiBlbnRyaWVzKSB7XG4gICAgaWYgKHJvdXRlcy5oYXMocGFnZS5yb3V0ZSkpIHRocm93IG5ldyBFcnJvcihgcHJvamVjdC1kb2Mtc2l0ZTogZHVwbGljYXRlIHJvdXRlICR7SlNPTi5zdHJpbmdpZnkocGFnZS5yb3V0ZSl9LmApXG4gICAgcm91dGVzLmFkZChwYWdlLnJvdXRlKVxuICAgIGNvbnN0IHNvdXJjZUFicyA9IHJlc29sdmUoY29udGV4dC5yZXBvUm9vdCwgcGFnZS5zb3VyY2UpXG4gICAgaWYgKCFleGlzdHNTeW5jKHNvdXJjZUFicykgfHwgIWxzdGF0U3luYyhzb3VyY2VBYnMpLmlzRmlsZSgpKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYHByb2plY3QtZG9jLXNpdGU6IHNvdXJjZSAke0pTT04uc3RyaW5naWZ5KHBhZ2Uuc291cmNlKX0gZG9lcyBub3QgZXhpc3Qgb3IgaXMgbm90IGEgZmlsZS5gKVxuICAgIH1cbiAgICBjb25zdCBvdXRwdXQgPSByZXNvbHZlKHRhcmdldFJvb3QsIHBhZ2Uucm91dGUpXG4gICAgLy8gQ2xhaW1lZCBiZWZvcmUgdGhlIGltYWdlcyBhcmUgcGxhY2VkOiBhIHBhZ2UgYW5kIGFuIGltYWdlIGxhbmRpbmcgb24gb25lXG4gICAgLy8gcGF0aCB3b3VsZCBvdGhlcndpc2Ugb3ZlcndyaXRlIGVhY2ggb3RoZXIgaW4gd2hpY2hldmVyIG9yZGVyIHRoZXkgcmFuLlxuICAgIGNsYWltKG91dHB1dCwgc291cmNlQWJzKVxuICAgIG1rZGlyU3luYyhkaXJuYW1lKG91dHB1dCksIHsgcmVjdXJzaXZlOiB0cnVlIH0pXG4gICAgY29uc3QgbWFya2Rvd24gPSByZWFkRmlsZVN5bmMoc291cmNlQWJzLCAndXRmOCcpXG4gICAgY29uc3QgcHJvamVjdGVkID0gcmV3cml0ZU1hcmtkb3duKG1hcmtkb3duLCB7XG4gICAgICBzb3VyY2VQYXRoOiBwYWdlLnNvdXJjZSxcbiAgICAgIGxvY2FsZTogcGFnZS5sb2NhbGUsXG4gICAgICByb3V0ZTogcGFnZS5yb3V0ZSxcbiAgICAgIHBhZ2VzOiBjb250ZXh0LnBhZ2VzLFxuICAgICAgcmVwb1Jvb3Q6IGNvbnRleHQucmVwb1Jvb3QsXG4gICAgICByZXBvc2l0b3J5UmVmOiBjb250ZXh0LnJlcG9zaXRvcnlSZWYsXG4gICAgICBwbGFjZUltYWdlOiAoYWJzUGF0aCkgPT4ge1xuICAgICAgICBjb25zdCByZWFsID0gcHVibGlzaGFibGVJbWFnZShhYnNQYXRoLCBjb250ZXh0LnJlcG9Sb290KVxuICAgICAgICBpZiAocmVhbCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgICAgICAgYHByb2plY3QtZG9jLXNpdGU6ICR7cGFnZS5zb3VyY2V9IHJlZmVyZW5jZXMgaW1hZ2UgJHtyZXBvUGF0aChhYnNQYXRoLCBjb250ZXh0LnJlcG9Sb290KX0sYFxuICAgICAgICAgICAgKyAnIHdoaWNoIGlzIG5vdCBhIHJlZ3VsYXIgZmlsZSBpbnNpZGUgdGhlIHJlcG9zaXRvcnkuJyxcbiAgICAgICAgICApXG4gICAgICAgIH1cbiAgICAgICAgLy8gQmVzaWRlIHRoZSBwYWdlIHRoYXQgcmVmZXJlbmNlcyBpdCwgdW5kZXIgaXRzIG93biBiYXNlbmFtZTogZWFjaFxuICAgICAgICAvLyBsb2NhbGUncyByb3V0ZSB0cmVlIGdldHMgaXRzIG93biBjb3B5LCBzbyBvbmUgcmVsYXRpdmUgVVJMIGlzIGNvcnJlY3RcbiAgICAgICAgLy8gZnJvbSBib3RoLlxuICAgICAgICBjb25zdCBuYW1lID0gYmFzZW5hbWUocmVhbClcbiAgICAgICAgY29uc3QgdGFyZ2V0ID0gcmVzb2x2ZShkaXJuYW1lKG91dHB1dCksIG5hbWUpXG4gICAgICAgIGNsYWltKHRhcmdldCwgcmVhbClcbiAgICAgICAgY29weUZpbGVTeW5jKHJlYWwsIHRhcmdldClcbiAgICAgICAgLy8gRW5jb2RlZCBiZWNhdXNlIHRoZSBkZXN0aW5hdGlvbiBpcyBhIE1hcmtkb3duIGlubGluZSB0YXJnZXQsIHdoZXJlIGFuXG4gICAgICAgIC8vIHVuZXNjYXBlZCBzcGFjZSB3b3VsZCBlbmQgaXQgZWFybHkuXG4gICAgICAgIHJldHVybiBgLi8ke2VuY29kZVVSSShuYW1lKX1gXG4gICAgICB9LFxuICAgIH0pXG4gICAgd3JpdGVGaWxlU3luYyhvdXRwdXQsIHBhZ2VDb250ZW50KHByb2plY3RlZCwgcGFnZSkpXG4gIH1cbn1cblxuLyoqIFJlYnVpbGQgdGhlIGRpc3Bvc2FibGUgVml0ZVByZXNzIHNvdXJjZSB0cmVlIGZyb20gdGhlIHB1YmxpY2F0aW9uIG1hbmlmZXN0LiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHByb2plY3REb2NzKCk6IHZvaWQge1xuICBybVN5bmMoZ2VuZXJhdGVkUm9vdCwgeyByZWN1cnNpdmU6IHRydWUsIGZvcmNlOiB0cnVlIH0pXG4gIHByb2plY3RQYWdlc0ludG8oZ2VuZXJhdGVkUm9vdCwgZGVmYXVsdFByb2plY3Rpb25Db250ZXh0KCksIChtYXJrZG93biwgcGFnZSkgPT5cbiAgICBhZGRQcm9qZWN0aW9uRnJvbnRtYXR0ZXIocHJvamVjdGVkUGFnZUNvbnRlbnQobWFya2Rvd24sIHBhZ2UpLCBwYWdlKSlcbn1cblxuLyoqXG4gKiBTdHJpcCB0aGUgbGVhZGluZyBZQU1MIGZyb250bWF0dGVyIG9mIGEgcHJvamVjdGVkIHBhZ2UuXG4gKlxuICogQHBhcmFtIG1hcmtkb3duIFJld3JpdHRlbiBjYW5vbmljYWwgTWFya2Rvd24gY29udGVudC5cbiAqIEBwYXJhbSBzb3VyY2UgUmVwb3NpdG9yeS1yZWxhdGl2ZSBwYWdlIHNvdXJjZSwgbmFtZWQgYnkgdGhlIGZhaWx1cmUuXG4gKiBAcmV0dXJucyBUaGUgY29udGVudCBhZnRlciB0aGUgZnJvbnRtYXR0ZXIgYmxvY2ssIG9yIHRoZSBpbnB1dCB3aGVuIG5vbmUgb3BlbnMgaXQuXG4gKi9cbmZ1bmN0aW9uIHdpdGhvdXRGcm9udG1hdHRlcihtYXJrZG93bjogc3RyaW5nLCBzb3VyY2U6IHN0cmluZyk6IHN0cmluZyB7XG4gIGlmICghbWFya2Rvd24uc3RhcnRzV2l0aCgnLS0tXFxuJykpIHJldHVybiBtYXJrZG93blxuICBjb25zdCBjbG9zaW5nRGVsaW1pdGVyID0gJ1xcbi0tLVxcbidcbiAgY29uc3QgY2xvc2luZyA9IG1hcmtkb3duLmluZGV4T2YoY2xvc2luZ0RlbGltaXRlciwgNClcbiAgaWYgKGNsb3NpbmcgPT09IC0xKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKGBwcm9qZWN0LWRvYy1zaXRlOiAke0pTT04uc3RyaW5naWZ5KHNvdXJjZSl9IGhhcyB1bmNsb3NlZCBZQU1MIGZyb250bWF0dGVyLmApXG4gIH1cbiAgcmV0dXJuIG1hcmtkb3duLnNsaWNlKGNsb3NpbmcgKyBjbG9zaW5nRGVsaW1pdGVyLmxlbmd0aCkucmVwbGFjZSgvXlxcbisvLCAnJylcbn1cblxuLyoqXG4gKiBUaGUgcmF3LU1hcmtkb3duIHR3aW4gb2Ygb25lIHB1Ymxpc2hlZCBwYWdlLlxuICpcbiAqIEZyb250bWF0dGVyIGlzIFZpdGVQcmVzcyByZW5kZXJpbmcgY29uZmlndXJhdGlvbiBhbmQgaXMgZHJvcHBlZC4gQSBsb2NhbGVcbiAqIGhvbWUgcGFnZSB0aGVyZWZvcmUga2VlcHMgaXRzIGJvZHkgaGVyZSwgd2hpbGUgdGhlIHJlbmRlcmVkIHNpdGUgdHJ1bmNhdGVzXG4gKiBpdCB0byB0aGUgZnJvbnRtYXR0ZXIgcmVkaXJlY3QuXG4gKlxuICogQHBhcmFtIG1hcmtkb3duIFJld3JpdHRlbiBjYW5vbmljYWwgTWFya2Rvd24gY29udGVudC5cbiAqIEBwYXJhbSBzb3VyY2UgUmVwb3NpdG9yeS1yZWxhdGl2ZSBwYWdlIHNvdXJjZSwgbmFtZWQgYnkgZnJvbnRtYXR0ZXIgZmFpbHVyZXMuXG4gKiBAcmV0dXJucyBQbGFpbiBNYXJrZG93biB3aXRob3V0IGZyb250bWF0dGVyIG9yIHJlcG9zaXRvcnkgY2hyb21lLlxuICovXG5leHBvcnQgZnVuY3Rpb24gcmF3TWFya2Rvd25QYWdlQ29udGVudChtYXJrZG93bjogc3RyaW5nLCBzb3VyY2U6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiB3aXRob3V0UmVwb3NpdG9yeUNocm9tZSh3aXRob3V0RnJvbnRtYXR0ZXIobWFya2Rvd24sIHNvdXJjZSkpXG59XG5cbi8qKlxuICogUGFyZW50LWxldmVsIGFsaWFzIHJvdXRlIG9mIGFuIGluZGV4IHJvdXRlLCBvciBgdW5kZWZpbmVkYCBmb3Igb3RoZXIgcm91dGVzLlxuICpcbiAqIFRoZSByZW5kZXJlZCBzaXRlIHNob3dzIGFuIGluZGV4IHJvdXRlIGFzIGEgZGlyZWN0b3J5IFVSTCwgc28gXCJhcHBlbmRcbiAqIGAubWRgXCIgbmF0dXJhbGx5IGxhbmRzIG9uIGA8ZGlyPi5tZGAgb25jZSB0aGUgdHJhaWxpbmcgc2xhc2ggaXMgZHJvcHBlZC5cbiAqIFRoZSByb290IGBpbmRleC5tZGAgaGFzIG5vIHBhcmVudCB0byBhbGlhcyBpbnRvLlxuICovXG5mdW5jdGlvbiBpbmRleEFsaWFzUm91dGUocm91dGU6IHN0cmluZyk6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gIGNvbnN0IG1hdGNoID0gL14oLispXFwvaW5kZXhcXC5tZCQvLmV4ZWMocm91dGUpXG4gIHJldHVybiBtYXRjaD8uWzFdID09PSB1bmRlZmluZWQgPyB1bmRlZmluZWQgOiBgJHttYXRjaFsxXX0ubWRgXG59XG5cbi8qKlxuICogU2l0ZS1yZWxhdGl2ZSBNYXJrZG93biBmaWxlcyB0aGUgcmF3LU1hcmtkb3duIHByb2plY3Rpb24gZW1pdHM6IGV2ZXJ5XG4gKiByb3V0ZSwgcGx1cyBvbmUgcGFyZW50LWxldmVsIGFsaWFzIHBlciBpbmRleCByb3V0ZS5cbiAqXG4gKiBAcGFyYW0gcGFnZXMgUGFnZXMgdG8gcHJvamVjdCwgZGVmYXVsdGluZyB0byB0aGUgcHVibGljYXRpb24gbWFuaWZlc3QuXG4gKiBAcmV0dXJucyBUaGUgZW1pdHRlZCBwYXRocywgcm91dGVzIGZpcnN0LlxuICovXG5leHBvcnQgZnVuY3Rpb24gcmF3TWFya2Rvd25GaWxlcyhwYWdlczogRG9jc1BhZ2VbXSA9IGRvY3NQYWdlcyk6IHN0cmluZ1tdIHtcbiAgY29uc3QgYWxpYXNlcyA9IHBhZ2VzLm1hcChwYWdlID0+IGluZGV4QWxpYXNSb3V0ZShwYWdlLnJvdXRlKSkuZmlsdGVyKGFsaWFzID0+IGFsaWFzICE9PSB1bmRlZmluZWQpXG4gIHJldHVybiBbLi4ucGFnZXMubWFwKHBhZ2UgPT4gcGFnZS5yb3V0ZSksIC4uLmFsaWFzZXNdXG59XG5cbi8qKlxuICogRW1pdCB0aGUgcmF3LU1hcmtkb3duIHR3aW4gb2YgZXZlcnkgcHVibGlzaGVkIHJvdXRlIGludG8gYSBidWlsdCBzaXRlLCBzb1xuICogc3RhdGljIGhvc3Rpbmcgc2VydmVzIHRoZSBwYWdlJ3MgVVJMLCBtaW51cyBhbnkgdHJhaWxpbmcgc2xhc2gsIHBsdXMgYC5tZGBcbiAqIGFzIHBsYWluIE1hcmtkb3duLiBFYWNoIGluZGV4IHJvdXRlIGFsc28gZW1pdHMgYSBwYXJlbnQtbGV2ZWwgYWxpYXMgdHdpbixcbiAqIHByb2plY3RlZCBvdmVyIHRoZSBhbGlhcyByb3V0ZSBzbyBpdHMgcmVsYXRpdmUgbGlua3Mgc3RheSBjb3JyZWN0LlxuICogUmVmZXJlbmNlZCBpbWFnZXMgYXJlIGNvcGllZCBiZXNpZGUgdGhlIHBhZ2VzLCBrZWVwaW5nIHRoZSBzYW1lIHJlbGF0aXZlXG4gKiBVUkxzIHZhbGlkIGluIGJvdGggdHJlZXMuIEV4aXN0aW5nIGJ1aWxkIGZpbGVzIHN0YXkgaW4gcGxhY2UsIGFuZCBhIG5hbWVcbiAqIGNvbGxpc2lvbiB3aXRoIG9uZSBmYWlscyB0aGUgZW1pc3Npb24uXG4gKlxuICogQHBhcmFtIG91dERpciBCdWlsZCBvdXRwdXQgZGlyZWN0b3J5IHRvIGVtaXQgaW50by5cbiAqIEBwYXJhbSBjb250ZXh0IE1hbmlmZXN0IGFuZCByZXBvc2l0b3J5IGlucHV0cywgZGVmYXVsdGluZyB0byB0aGlzIHJlcG9zaXRvcnkuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBlbWl0UmF3TWFya2Rvd25QYWdlcyhvdXREaXI6IHN0cmluZywgY29udGV4dDogUHJvamVjdGlvbkNvbnRleHQgPSBkZWZhdWx0UHJvamVjdGlvbkNvbnRleHQoKSk6IHZvaWQge1xuICBjb25zdCBhbGlhc2VzID0gY29udGV4dC5wYWdlcy5mbGF0TWFwKChwYWdlKSA9PiB7XG4gICAgY29uc3QgYWxpYXMgPSBpbmRleEFsaWFzUm91dGUocGFnZS5yb3V0ZSlcbiAgICByZXR1cm4gYWxpYXMgPT09IHVuZGVmaW5lZCA/IFtdIDogW3sgLi4ucGFnZSwgcm91dGU6IGFsaWFzIH1dXG4gIH0pXG4gIHByb2plY3RQYWdlc0ludG8oXG4gICAgb3V0RGlyLFxuICAgIGNvbnRleHQsXG4gICAgKG1hcmtkb3duLCBwYWdlKSA9PiByYXdNYXJrZG93blBhZ2VDb250ZW50KG1hcmtkb3duLCBwYWdlLnNvdXJjZSksXG4gICAgWy4uLmNvbnRleHQucGFnZXMsIC4uLmFsaWFzZXNdLFxuICApXG59XG5cbi8qKlxuICogUmF3IE1hcmtkb3duIHNlcnZlZCBmb3Igb25lIHNpdGUgcm91dGUuXG4gKlxuICogRGV2LXNlcnZlciBjb3VudGVycGFydCBvZiB7QGxpbmsgZW1pdFJhd01hcmtkb3duUGFnZXN9OiBpbWFnZXMgYXJlIG5vdFxuICogY29waWVkIGJlY2F1c2UgdGhlIGdlbmVyYXRlZCB0cmVlIGFscmVhZHkgc2VydmVzIHRoZW0gYmVzaWRlIHRoZSBwYWdlLlxuICpcbiAqIEBwYXJhbSByb3V0ZSBNYW5pZmVzdCByb3V0ZSwgaW5jbHVkaW5nIGl0cyBgLm1kYCBzdWZmaXguXG4gKiBAcGFyYW0gY29udGV4dCBNYW5pZmVzdCBhbmQgcmVwb3NpdG9yeSBpbnB1dHMsIGRlZmF1bHRpbmcgdG8gdGhpcyByZXBvc2l0b3J5LlxuICogQHJldHVybnMgVGhlIHByb2plY3RlZCBwYWdlLCBvciBgdW5kZWZpbmVkYCB3aGVuIHRoZSBtYW5pZmVzdCBkb2VzIG5vdCBwdWJsaXNoIHRoZSByb3V0ZS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJhd01hcmtkb3duUm91dGUocm91dGU6IHN0cmluZywgY29udGV4dDogUHJvamVjdGlvbkNvbnRleHQgPSBkZWZhdWx0UHJvamVjdGlvbkNvbnRleHQoKSk6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gIGNvbnN0IHBhZ2UgPSBjb250ZXh0LnBhZ2VzLmZpbmQoY2FuZGlkYXRlID0+IGNhbmRpZGF0ZS5yb3V0ZSA9PT0gcm91dGUpXG4gIGlmIChwYWdlID09PSB1bmRlZmluZWQpIHJldHVybiB1bmRlZmluZWRcbiAgY29uc3QgbWFya2Rvd24gPSByZWFkRmlsZVN5bmMocmVzb2x2ZShjb250ZXh0LnJlcG9Sb290LCBwYWdlLnNvdXJjZSksICd1dGY4JylcbiAgcmV0dXJuIHJhd01hcmtkb3duUGFnZUNvbnRlbnQocmV3cml0ZU1hcmtkb3duKG1hcmtkb3duLCB7XG4gICAgc291cmNlUGF0aDogcGFnZS5zb3VyY2UsXG4gICAgbG9jYWxlOiBwYWdlLmxvY2FsZSxcbiAgICByb3V0ZTogcGFnZS5yb3V0ZSxcbiAgICBwYWdlczogY29udGV4dC5wYWdlcyxcbiAgICByZXBvUm9vdDogY29udGV4dC5yZXBvUm9vdCxcbiAgICByZXBvc2l0b3J5UmVmOiBjb250ZXh0LnJlcG9zaXRvcnlSZWYsXG4gICAgcGxhY2VJbWFnZTogYWJzUGF0aCA9PiBgLi8ke2VuY29kZVVSSShiYXNlbmFtZShhYnNQYXRoKSl9YCxcbiAgfSksIHBhZ2Uuc291cmNlKVxufVxuXG4vKiogU2l0ZSBpZGVudGl0eSB3cml0dGVuIGludG8gbGxtcy50eHQuICovXG5leHBvcnQgaW50ZXJmYWNlIExsbXNUeHRTaXRlIHtcbiAgLyoqIFNpdGUgYmFzZSBwYXRoLCBjYXJyeWluZyB0aGUgbGVhZGluZyBhbmQgdHJhaWxpbmcgc2xhc2hlcyBWaXRlUHJlc3MgcmVxdWlyZXMuICovXG4gIGJhc2U6IHN0cmluZ1xuICAvKiogU2l0ZSB0aXRsZS4gKi9cbiAgdGl0bGU6IHN0cmluZ1xuICAvKiogU2l0ZSBkZXNjcmlwdGlvbi4gKi9cbiAgZGVzY3JpcHRpb246IHN0cmluZ1xufVxuXG4vKiogTG9jYWxlIGdyb3VwcyBsbG1zLnR4dCBsaXN0cywgaW4gdGhlIG9yZGVyIHRoZSBzaXRlJ3MgbmF2aWdhdGlvbiBwcmVzZW50cyB0aGVtLiAqL1xuY29uc3QgbGxtc1R4dExvY2FsZXM6IHJlYWRvbmx5IHsgaGVhZGluZzogc3RyaW5nOyBsb2NhbGU6IERvY3NMb2NhbGUgfVtdID0gW1xuICB7IGhlYWRpbmc6ICdcdTdCODBcdTRGNTNcdTRFMkRcdTY1ODcnLCBsb2NhbGU6ICdyb290JyB9LFxuICB7IGhlYWRpbmc6ICdFbmdsaXNoJywgbG9jYWxlOiAnZW4nIH0sXG5dXG5cbi8qKlxuICogVGhlIGxsbXMudHh0IGluZGV4IG9mIGV2ZXJ5IHB1Ymxpc2hlZCBwYWdlJ3MgcmF3LU1hcmtkb3duIHR3aW4uXG4gKlxuICogTGlua3MgYXJlIHNpdGUtYWJzb2x1dGUgc28gYW4gYWdlbnQgcmVzb2x2ZXMgdGhlbSBhZ2FpbnN0IHRoZSBob3N0IGl0XG4gKiBmZXRjaGVkIGxsbXMudHh0IGZyb207IGxvY2FsZSBob21lIHBhZ2VzIHN0YXkgb3V0IGJlY2F1c2UgdGhpcyBmaWxlIGlzIHRoZVxuICogYWdlbnQtZmFjaW5nIGVudHJ5IHBvaW50IGl0c2VsZi5cbiAqXG4gKiBAcGFyYW0gc2l0ZSBTaXRlIGlkZW50aXR5IGFuZCBiYXNlIHBhdGguXG4gKiBAcmV0dXJucyBsbG1zLnR4dCBjb250ZW50IGxpc3RpbmcgYm90aCBsb2NhbGUgdHJlZXMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBsbG1zVHh0KHNpdGU6IExsbXNUeHRTaXRlKTogc3RyaW5nIHtcbiAgY29uc3QgbGluZXMgPSBbXG4gICAgYCMgJHtzaXRlLnRpdGxlfWAsXG4gICAgJycsXG4gICAgYD4gJHtzaXRlLmRlc2NyaXB0aW9ufWAsXG4gICAgJycsXG4gICAgJ1x1OTg3NVx1OTc2MiBVUkwgXHU1M0JCXHU2Mzg5XHU2NzJCXHU1QzNFXHU2NTlDXHU2NzYwXHU1MThEXHU1MkEwIGAubWRgIFx1NTM3M1x1NEUzQVx1OEJFNVx1OTg3NVx1NTM5Rlx1NTlDQiBNYXJrZG93bihcdTY4MzlcdThERUZcdTVGODRcdTc1MjggYC9pbmRleC5tZGApO1x1NEUwQlx1NjVCOVx1NTIxN1x1ODg2OFx1NjYyRlx1NTQwNFx1OTg3NVx1N0NCRVx1Nzg2RVx1NTczMFx1NTc0MFx1MzAwMkRyb3AgYW55IHRyYWlsaW5nIHNsYXNoIGFuZCBhcHBlbmQgYC5tZGAgdG8gYSBwYWdlIFVSTCBmb3IgaXRzIHJhdyBNYXJrZG93biAodGhlIHNpdGUgcm9vdCBpcyBgL2luZGV4Lm1kYCk7IHRoZSBsaXN0IGJlbG93IGNhcnJpZXMgdGhlIGV4YWN0IGFkZHJlc3Nlcy4nLFxuICBdXG4gIGZvciAoY29uc3QgeyBoZWFkaW5nLCBsb2NhbGUgfSBvZiBsbG1zVHh0TG9jYWxlcykge1xuICAgIGxpbmVzLnB1c2goJycsIGAjIyAke2hlYWRpbmd9YCwgJycpXG4gICAgZm9yIChjb25zdCBjb2xsZWN0aW9uIG9mIGxvY2FsZUNvbGxlY3Rpb25zW2xvY2FsZV0pIHtcbiAgICAgIGZvciAoY29uc3QgcGFnZSBvZiBvcmRlcmVkUGFnZXMobG9jYWxlLCBjb2xsZWN0aW9uKSkge1xuICAgICAgICBsaW5lcy5wdXNoKGAtIFske3BhZ2UubGFiZWx9XSgke3NpdGUuYmFzZX0ke3BhZ2Uucm91dGV9KTogJHtwYWdlLnNlY3Rpb259YClcbiAgICAgIH1cbiAgICB9XG4gIH1cbiAgcmV0dXJuIGAke2xpbmVzLmpvaW4oJ1xcbicpfVxcbmBcbn1cbiIsICJjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfZGlybmFtZSA9IFwiRTpcXFxcTWl4XFxcXHByb2plY3RcXFxcZGVlcHNlZWstaGFybmVzc1xcXFwud29ya3RyZWVzXFxcXHVwc3RyZWFtLWZpcnN0XFxcXHNjcmlwdHNcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfZmlsZW5hbWUgPSBcIkU6XFxcXE1peFxcXFxwcm9qZWN0XFxcXGRlZXBzZWVrLWhhcm5lc3NcXFxcLndvcmt0cmVlc1xcXFx1cHN0cmVhbS1maXJzdFxcXFxzY3JpcHRzXFxcXG1hcmtkb3duLnRzXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ltcG9ydF9tZXRhX3VybCA9IFwiZmlsZTovLy9FOi9NaXgvcHJvamVjdC9kZWVwc2Vlay1oYXJuZXNzLy53b3JrdHJlZXMvdXBzdHJlYW0tZmlyc3Qvc2NyaXB0cy9tYXJrZG93bi50c1wiOy8qKiBTaGFyZWQgTWFya2Rvd24gcGFyc2luZyBhbmQgZGVwdGgtZmlyc3QgdHJhdmVyc2FsIGZvciBkb2N1bWVudGF0aW9uIGdhdGVzLiAqL1xuXG5pbXBvcnQgeyBmcm9tTWFya2Rvd24gfSBmcm9tICdtZGFzdC11dGlsLWZyb20tbWFya2Rvd24nXG5pbXBvcnQgeyBnZm1Gcm9tTWFya2Rvd24gfSBmcm9tICdtZGFzdC11dGlsLWdmbSdcbmltcG9ydCB7IGdmbSB9IGZyb20gJ21pY3JvbWFyay1leHRlbnNpb24tZ2ZtJ1xuaW1wb3J0IHR5cGUgeyBOb2RlcyB9IGZyb20gJ21kYXN0J1xuXG4vKiogT25lIGF1dGhvcmVkIE1hcmtkb3duIGxpbmUgb3V0c2lkZSBmZW5jZWQgY29kZSBhbmQgcmVuZGVyZWQtYXdheSBIVE1MIGNvbW1lbnRzLiAqL1xuZXhwb3J0IGludGVyZmFjZSBNYXJrZG93blByb3NlTGluZSB7XG4gIC8qKiAxLWJhc2VkIHNvdXJjZSBsaW5lIG51bWJlci4gKi9cbiAgaW5kZXg6IG51bWJlclxuICAvKiogU291cmNlIHRleHQgd2l0aG91dCBub3JtYWxpemF0aW9uLiAqL1xuICByYXc6IHN0cmluZ1xufVxuXG4vKiogT25lIHBhcnNlZCBNYXJrZG93biBoZWFkaW5nLCByZXRhaW5pbmcgaXRzIGF1dGhvcmVkIGZpcnN0IGxpbmUgYW5kIHJlbmRlcmVkIHRleHQuICovXG5leHBvcnQgaW50ZXJmYWNlIE1hcmtkb3duSGVhZGluZ0xpbmUgZXh0ZW5kcyBNYXJrZG93blByb3NlTGluZSB7XG4gIC8qKiBQYXJzZWQgQVRYIG9yIFNldGV4dCBoZWFkaW5nIGRlcHRoLiAqL1xuICBkZXB0aDogMSB8IDIgfCAzIHwgNCB8IDUgfCA2XG4gIC8qKiBSZW5kZXJlZCBoZWFkaW5nIHRleHQsIGV4Y2x1ZGluZyByYXcgSFRNTCBzdWNoIGFzIGNvbW1lbnRzLiAqL1xuICB0ZXh0OiBzdHJpbmdcbn1cblxuLyoqIE9uZSBjb2RlIGJsb2NrIGZyb20gYSBwYXJzZWQgTWFya2Rvd24gc291cmNlLiAqL1xuZXhwb3J0IGludGVyZmFjZSBNYXJrZG93bkZlbmNlIHtcbiAgLyoqIDEtYmFzZWQgc291cmNlIGxpbmUgb2YgdGhlIG9wZW5pbmcgZmVuY2UuICovXG4gIGxpbmU6IG51bWJlclxuICAvKiogSW5mby1zdHJpbmcgbGFuZ3VhZ2UgKGl0cyBmaXJzdCB3b3JkKSwgbnVsbCBvbiBhIGJhcmUgb3IgaW5kZW50ZWQgYmxvY2suICovXG4gIGxhbmc6IHN0cmluZyB8IG51bGxcbiAgLyoqIEZ1bGwgaW5mbyBzdHJpbmcgKGUuZy4gYHRzIGlnbm9yZS1jaGVja2ApLCAnJyBvbiBhIGJhcmUgb3IgaW5kZW50ZWQgYmxvY2suICovXG4gIGluZm86IHN0cmluZ1xuICAvKiogQmxvY2sgYm9keSB3aXRob3V0IHRoZSBmZW5jZSBkZWxpbWl0ZXJzLiAqL1xuICBjb2RlOiBzdHJpbmdcbiAgLyoqXG4gICAqIFdoZXRoZXIgYSBjbG9zaW5nIGZlbmNlIGRlbGltaXRlciB0ZXJtaW5hdGVzIHRoZSBibG9jayBcdTIwMTQgbWRhc3Qgc2lsZW50bHlcbiAgICogY2xvc2VzIGFuIHVudGVybWluYXRlZCBmZW5jZSBhdCBlbmQgb2YgZmlsZS4gRmFsc2Ugb24gaW5kZW50ZWRcbiAgICogKG5vbi1mZW5jZWQpIGJsb2Nrcywgd2hvc2UgZW5kIGxpbmUgaXMgY29kZS5cbiAgICovXG4gIGNsb3NlZDogYm9vbGVhblxufVxuXG4vKiogUGFyc2UgR2l0SHViLWZsYXZvcmVkIE1hcmtkb3duIHdpdGggdGhlIHJlcG9zaXRvcnkncyBzdGFuZGFyZCBleHRlbnNpb25zLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlTWFya2Rvd24oc291cmNlOiBzdHJpbmcpOiBOb2RlcyB7XG4gIHJldHVybiBmcm9tTWFya2Rvd24oc291cmNlLCB7IGV4dGVuc2lvbnM6IFtnZm0oKV0sIG1kYXN0RXh0ZW5zaW9uczogW2dmbUZyb21NYXJrZG93bigpXSB9KVxufVxuXG4vKipcbiAqIFZpc2l0IGEgTWFya2Rvd24gdHJlZSBkZXB0aC1maXJzdDsgcmV0dXJuaW5nIGZhbHNlIHBydW5lcyBhIG5vZGUncyBjaGlsZHJlbi5cbiAqIEBwYXJhbSBub2RlIC0gY3VycmVudCB0cmVlIG5vZGUuXG4gKiBAcGFyYW0gdmlzaXRvciAtIGNhbGxiYWNrIGludm9rZWQgYmVmb3JlIGVhY2ggbm9kZSdzIGNoaWxkcmVuLlxuICovXG5leHBvcnQgZnVuY3Rpb24gdmlzaXRNYXJrZG93bihub2RlOiBOb2RlcywgdmlzaXRvcjogKG5vZGU6IE5vZGVzKSA9PiBib29sZWFuIHwgdm9pZCk6IHZvaWQge1xuICBpZiAodmlzaXRvcihub2RlKSA9PT0gZmFsc2UpIHJldHVyblxuICBpZiAoJ2NoaWxkcmVuJyBpbiBub2RlKSB7XG4gICAgZm9yIChjb25zdCBjaGlsZCBvZiBub2RlLmNoaWxkcmVuKSB2aXNpdE1hcmtkb3duKGNoaWxkLCB2aXNpdG9yKVxuICB9XG59XG5cbi8qKiBNYXJrZG93biBub2RlcyB3aG9zZSBhdXRob3JlZCBkZXN0aW5hdGlvbiBvY2N1cGllcyBhIHJlcGxhY2VhYmxlIHNvdXJjZSByYW5nZS4gKi9cbmV4cG9ydCB0eXBlIE1hcmtkb3duRGVzdGluYXRpb25Ob2RlID0gRXh0cmFjdDxOb2RlcywgeyB0eXBlOiAnbGluaycgfCAnaW1hZ2UnIHwgJ2RlZmluaXRpb24nIH0+XG5cbi8qKiBPbmUgYXV0aG9yZWQgTWFya2Rvd24gZGVzdGluYXRpb24gYW5kIGl0cyBhYnNvbHV0ZSBzb3VyY2Ugb2Zmc2V0cy4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgTWFya2Rvd25EZXN0aW5hdGlvbiB7XG4gIHN0YXJ0OiBudW1iZXJcbiAgZW5kOiBudW1iZXJcbiAgdXJsOiBzdHJpbmdcbn1cblxuLyoqIFdoZXRoZXIgYSBNYXJrZG93biBVUkwgaXMgZXh0ZXJuYWwsIHJlcG9zaXRvcnktcm9vdCBhYnNvbHV0ZSwgb3IgcHVyZWx5IGluLXBhZ2UuICovXG5leHBvcnQgZnVuY3Rpb24gaXNFeHRlcm5hbE9yQWJzb2x1dGVNYXJrZG93blVybCh1cmw6IHN0cmluZyk6IGJvb2xlYW4ge1xuICByZXR1cm4gdXJsLnN0YXJ0c1dpdGgoJyMnKVxuICAgIHx8IHVybC5zdGFydHNXaXRoKCcvLycpXG4gICAgfHwgdXJsLnN0YXJ0c1dpdGgoJy8nKVxuICAgIHx8IC9eW2EtekEtWl1bYS16QS1aMC05Ky4tXSo6Ly50ZXN0KHVybClcbn1cblxuLyoqIFNwbGl0IG9uZSBNYXJrZG93biBVUkwgd2l0aG91dCBub3JtYWxpemluZyBpdHMgcXVlcnkgb3IgZnJhZ21lbnQgc3VmZml4LiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHNwbGl0TWFya2Rvd25VcmxUYXJnZXQodXJsOiBzdHJpbmcpOiB7IHBhdGg6IHN0cmluZzsgc3VmZml4OiBzdHJpbmcgfSB7XG4gIGNvbnN0IGJvdW5kYXJ5ID0gdXJsLnNlYXJjaCgvWz8jXS8pXG4gIGlmIChib3VuZGFyeSA9PT0gLTEpIHJldHVybiB7IHBhdGg6IHVybCwgc3VmZml4OiAnJyB9XG4gIHJldHVybiB7IHBhdGg6IHVybC5zbGljZSgwLCBib3VuZGFyeSksIHN1ZmZpeDogdXJsLnNsaWNlKGJvdW5kYXJ5KSB9XG59XG5cbmZ1bmN0aW9uIHNraXBXaGl0ZXNwYWNlKHNvdXJjZTogc3RyaW5nLCBzdGFydDogbnVtYmVyKTogbnVtYmVyIHtcbiAgbGV0IGluZGV4ID0gc3RhcnRcbiAgd2hpbGUgKC9cXHMvLnRlc3Qoc291cmNlW2luZGV4XSA/PyAnJykpIGluZGV4ICs9IDFcbiAgcmV0dXJuIGluZGV4XG59XG5cbmZ1bmN0aW9uIGxhYmVsRW5kKHNvdXJjZTogc3RyaW5nKTogbnVtYmVyIHtcbiAgY29uc3QgZmlyc3QgPSBzb3VyY2UuaW5kZXhPZignWycpXG4gIGlmIChmaXJzdCA9PT0gLTEpIHJldHVybiAtMVxuICBsZXQgZGVwdGggPSAwXG4gIGZvciAobGV0IGluZGV4ID0gZmlyc3Q7IGluZGV4IDwgc291cmNlLmxlbmd0aDsgaW5kZXggKz0gMSkge1xuICAgIGNvbnN0IGNoYXIgPSBzb3VyY2VbaW5kZXhdXG4gICAgaWYgKGNoYXIgPT09ICdcXFxcJykgaW5kZXggKz0gMVxuICAgIGVsc2UgaWYgKGNoYXIgPT09ICdbJykgZGVwdGggKz0gMVxuICAgIGVsc2UgaWYgKGNoYXIgPT09ICddJykge1xuICAgICAgZGVwdGggLT0gMVxuICAgICAgaWYgKGRlcHRoID09PSAwKSByZXR1cm4gaW5kZXhcbiAgICB9XG4gIH1cbiAgcmV0dXJuIC0xXG59XG5cbmZ1bmN0aW9uIGRlc3RpbmF0aW9uUmFuZ2UocmF3Tm9kZTogc3RyaW5nLCB0eXBlOiBNYXJrZG93bkRlc3RpbmF0aW9uTm9kZVsndHlwZSddKTogeyBzdGFydDogbnVtYmVyOyBlbmQ6IG51bWJlciB9IHtcbiAgY29uc3QgZW5kT2ZMYWJlbCA9IGxhYmVsRW5kKHJhd05vZGUpXG4gIGlmIChlbmRPZkxhYmVsID09PSAtMSkgdGhyb3cgbmV3IEVycm9yKGBtYXJrZG93bjogY2Fubm90IGxvY2F0ZSBsYWJlbCBlbmQgaW4gJHtKU09OLnN0cmluZ2lmeShyYXdOb2RlKX1gKVxuICBsZXQgc3RhcnQ6IG51bWJlclxuICBpZiAodHlwZSA9PT0gJ2RlZmluaXRpb24nKSB7XG4gICAgY29uc3QgY29sb24gPSByYXdOb2RlLmluZGV4T2YoJzonLCBlbmRPZkxhYmVsICsgMSlcbiAgICBpZiAoY29sb24gPT09IC0xKSB0aHJvdyBuZXcgRXJyb3IoYG1hcmtkb3duOiBjYW5ub3QgbG9jYXRlIGRlZmluaXRpb24gc2VwYXJhdG9yIGluICR7SlNPTi5zdHJpbmdpZnkocmF3Tm9kZSl9YClcbiAgICBzdGFydCA9IHNraXBXaGl0ZXNwYWNlKHJhd05vZGUsIGNvbG9uICsgMSlcbiAgfSBlbHNlIHtcbiAgICBpZiAocmF3Tm9kZVtlbmRPZkxhYmVsICsgMV0gIT09ICcoJykge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBtYXJrZG93bjogY2Fubm90IGxvY2F0ZSBpbmxpbmUgZGVzdGluYXRpb24gaW4gJHtKU09OLnN0cmluZ2lmeShyYXdOb2RlKX1gKVxuICAgIH1cbiAgICBzdGFydCA9IHNraXBXaGl0ZXNwYWNlKHJhd05vZGUsIGVuZE9mTGFiZWwgKyAyKVxuICB9XG4gIGlmIChyYXdOb2RlW3N0YXJ0XSA9PT0gJzwnKSB7XG4gICAgZm9yIChsZXQgaW5kZXggPSBzdGFydCArIDE7IGluZGV4IDwgcmF3Tm9kZS5sZW5ndGg7IGluZGV4ICs9IDEpIHtcbiAgICAgIGlmIChyYXdOb2RlW2luZGV4XSA9PT0gJ1xcXFwnKSBpbmRleCArPSAxXG4gICAgICBlbHNlIGlmIChyYXdOb2RlW2luZGV4XSA9PT0gJz4nKSByZXR1cm4geyBzdGFydDogc3RhcnQgKyAxLCBlbmQ6IGluZGV4IH1cbiAgICB9XG4gICAgdGhyb3cgbmV3IEVycm9yKGBtYXJrZG93bjogY2Fubm90IGxvY2F0ZSBhbmdsZS1icmFja2V0IGRlc3RpbmF0aW9uIGVuZCBpbiAke0pTT04uc3RyaW5naWZ5KHJhd05vZGUpfWApXG4gIH1cbiAgbGV0IGRlcHRoID0gMFxuICBmb3IgKGxldCBpbmRleCA9IHN0YXJ0OyBpbmRleCA8IHJhd05vZGUubGVuZ3RoOyBpbmRleCArPSAxKSB7XG4gICAgY29uc3QgY2hhciA9IHJhd05vZGVbaW5kZXhdXG4gICAgaWYgKGNoYXIgPT09ICdcXFxcJykgaW5kZXggKz0gMVxuICAgIGVsc2UgaWYgKGNoYXIgPT09ICcoJykgZGVwdGggKz0gMVxuICAgIGVsc2UgaWYgKGNoYXIgPT09ICcpJykge1xuICAgICAgaWYgKGRlcHRoID09PSAwKSByZXR1cm4geyBzdGFydCwgZW5kOiBpbmRleCB9XG4gICAgICBkZXB0aCAtPSAxXG4gICAgfSBlbHNlIGlmICgvXFxzLy50ZXN0KGNoYXIgPz8gJycpICYmIGRlcHRoID09PSAwKSB7XG4gICAgICByZXR1cm4geyBzdGFydCwgZW5kOiBpbmRleCB9XG4gICAgfVxuICB9XG4gIHJldHVybiB7IHN0YXJ0LCBlbmQ6IHJhd05vZGUubGVuZ3RoIH1cbn1cblxuLyoqIExvY2F0ZSBvbmUgcGFyc2VkIGRlc3RpbmF0aW9uIGluIHRoZSBvcmlnaW5hbCBNYXJrZG93biB3aXRob3V0IHJlc2VyaWFsaXppbmcgaXQuICovXG5leHBvcnQgZnVuY3Rpb24gbWFya2Rvd25EZXN0aW5hdGlvbihzb3VyY2U6IHN0cmluZywgbm9kZTogTWFya2Rvd25EZXN0aW5hdGlvbk5vZGUpOiBNYXJrZG93bkRlc3RpbmF0aW9uIHtcbiAgY29uc3Qgc3RhcnQgPSBub2RlLnBvc2l0aW9uPy5zdGFydC5vZmZzZXRcbiAgY29uc3QgZW5kID0gbm9kZS5wb3NpdGlvbj8uZW5kLm9mZnNldFxuICBpZiAoc3RhcnQgPT09IHVuZGVmaW5lZCB8fCBlbmQgPT09IHVuZGVmaW5lZCkge1xuICAgIHRocm93IG5ldyBFcnJvcihgbWFya2Rvd246IGRlc3RpbmF0aW9uICR7SlNPTi5zdHJpbmdpZnkobm9kZS51cmwpfSBoYXMgbm8gc291cmNlIG9mZnNldHNgKVxuICB9XG4gIGNvbnN0IHJhbmdlID0gZGVzdGluYXRpb25SYW5nZShzb3VyY2Uuc2xpY2Uoc3RhcnQsIGVuZCksIG5vZGUudHlwZSlcbiAgY29uc3QgYWJzb2x1dGUgPSB7IHN0YXJ0OiBzdGFydCArIHJhbmdlLnN0YXJ0LCBlbmQ6IHN0YXJ0ICsgcmFuZ2UuZW5kIH1cbiAgcmV0dXJuIHsgLi4uYWJzb2x1dGUsIHVybDogc291cmNlLnNsaWNlKGFic29sdXRlLnN0YXJ0LCBhYnNvbHV0ZS5lbmQpIH1cbn1cblxuLyoqXG4gKiBFeHRyYWN0IGV2ZXJ5IHBhcnNlZCBjb2RlIGJsb2NrIHdpdGggaXRzIGluZm8gc3RyaW5nLCBpbiBkb2N1bWVudCBvcmRlci5cbiAqIEBwYXJhbSBzb3VyY2UgLSBNYXJrZG93biBzb3VyY2UgdG8gc2Nhbi5cbiAqIEByZXR1cm5zIGVhY2ggYmxvY2sncyBvcGVuaW5nIGxpbmUsIGxhbmd1YWdlLCBpbmZvIHN0cmluZywgYW5kIGJvZHkuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBtYXJrZG93bkZlbmNlcyhzb3VyY2U6IHN0cmluZyk6IE1hcmtkb3duRmVuY2VbXSB7XG4gIGNvbnN0IGxpbmVzID0gc291cmNlLnNwbGl0KCdcXG4nKVxuICBjb25zdCBmZW5jZXM6IE1hcmtkb3duRmVuY2VbXSA9IFtdXG4gIHZpc2l0TWFya2Rvd24ocGFyc2VNYXJrZG93bihzb3VyY2UpLCAobm9kZSkgPT4ge1xuICAgIGlmIChub2RlLnR5cGUgIT09ICdjb2RlJyB8fCBub2RlLnBvc2l0aW9uID09PSB1bmRlZmluZWQpIHJldHVyblxuICAgIGNvbnN0IGxhbmcgPSBub2RlLmxhbmcgPz8gbnVsbFxuICAgIGNvbnN0IG1ldGEgPSBub2RlLm1ldGEgPz8gJydcbiAgICBjb25zdCBpbmZvID0gbGFuZyA9PT0gbnVsbCA/ICcnIDogbWV0YSA9PT0gJycgPyBsYW5nIDogYCR7bGFuZ30gJHttZXRhfWBcbiAgICBjb25zdCBlbmRMaW5lID0gbGluZXNbbm9kZS5wb3NpdGlvbi5lbmQubGluZSAtIDFdID8/ICcnXG4gICAgY29uc3QgY2xvc2VkID0gL14gezAsM30oYHszLH18fnszLH0pXFxzKiQvLnRlc3QoZW5kTGluZSlcbiAgICBmZW5jZXMucHVzaCh7IGxpbmU6IG5vZGUucG9zaXRpb24uc3RhcnQubGluZSwgbGFuZywgaW5mbywgY29kZTogbm9kZS52YWx1ZSwgY2xvc2VkIH0pXG4gIH0pXG4gIHJldHVybiBmZW5jZXNcbn1cblxuLyoqIFRleHQgYSByZWFkZXIgc2VlcyBmcm9tIG9uZSBNYXJrZG93biBub2RlOyByYXcgSFRNTCBpdHNlbGYgY29udHJpYnV0ZXMgbm9uZS4gKi9cbmZ1bmN0aW9uIHJlbmRlcmVkVGV4dChub2RlOiBOb2Rlcyk6IHN0cmluZyB7XG4gIGlmIChub2RlLnR5cGUgPT09ICd0ZXh0JyB8fCBub2RlLnR5cGUgPT09ICdpbmxpbmVDb2RlJykgcmV0dXJuIG5vZGUudmFsdWVcbiAgaWYgKG5vZGUudHlwZSA9PT0gJ2ltYWdlJyB8fCBub2RlLnR5cGUgPT09ICdpbWFnZVJlZmVyZW5jZScpIHJldHVybiBub2RlLmFsdCA/PyAnJ1xuICBpZiAobm9kZS50eXBlID09PSAnYnJlYWsnKSByZXR1cm4gJyAnXG4gIGlmICgnY2hpbGRyZW4nIGluIG5vZGUpIHJldHVybiBub2RlLmNoaWxkcmVuLm1hcChjaGlsZCA9PiByZW5kZXJlZFRleHQoY2hpbGQpKS5qb2luKCcnKVxuICByZXR1cm4gJydcbn1cblxuLyoqIFJldHVybiBldmVyeSBwYXJzZWQgTWFya2Rvd24gaGVhZGluZyB3aXRoIGl0cyByZW5kZXJlZCB0ZXh0IGFuZCBzb3VyY2UgbGluZS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBtYXJrZG93bkhlYWRpbmdMaW5lcyhzb3VyY2U6IHN0cmluZyk6IE1hcmtkb3duSGVhZGluZ0xpbmVbXSB7XG4gIGNvbnN0IHJhd0xpbmVzID0gc291cmNlLnNwbGl0KCdcXG4nKVxuICBjb25zdCBoZWFkaW5nczogTWFya2Rvd25IZWFkaW5nTGluZVtdID0gW11cbiAgdmlzaXRNYXJrZG93bihwYXJzZU1hcmtkb3duKHNvdXJjZSksIChub2RlKSA9PiB7XG4gICAgaWYgKG5vZGUudHlwZSAhPT0gJ2hlYWRpbmcnIHx8IG5vZGUucG9zaXRpb24gPT09IHVuZGVmaW5lZCkgcmV0dXJuXG4gICAgaGVhZGluZ3MucHVzaCh7XG4gICAgICBkZXB0aDogbm9kZS5kZXB0aCxcbiAgICAgIGluZGV4OiBub2RlLnBvc2l0aW9uLnN0YXJ0LmxpbmUsXG4gICAgICByYXc6IHJhd0xpbmVzW25vZGUucG9zaXRpb24uc3RhcnQubGluZSAtIDFdID8/ICcnLFxuICAgICAgdGV4dDogcmVuZGVyZWRUZXh0KG5vZGUpLFxuICAgIH0pXG4gIH0pXG4gIHJldHVybiBoZWFkaW5nc1xufVxuXG50eXBlIENvbHVtblJhbmdlID0gcmVhZG9ubHkgW3N0YXJ0OiBudW1iZXIsIGVuZDogbnVtYmVyXVxudHlwZSBPZmZzZXRSYW5nZSA9IHJlYWRvbmx5IFtzdGFydDogbnVtYmVyLCBlbmQ6IG51bWJlcl1cblxuLyoqIFNvdXJjZS1jb2x1bW4gcmFuZ2VzIG9jY3VwaWVkIGJ5IHBhcnNlZCBIVE1MIGNvbW1lbnRzLCBrZXllZCBieSBzb3VyY2UgbGluZS4gKi9cbmZ1bmN0aW9uIGh0bWxDb21tZW50UmFuZ2VzKHNvdXJjZTogc3RyaW5nLCByYXdMaW5lczogcmVhZG9ubHkgc3RyaW5nW10pOiBNYXA8bnVtYmVyLCBDb2x1bW5SYW5nZVtdPiB7XG4gIGNvbnN0IGNvbW1lbnRzOiBPZmZzZXRSYW5nZVtdID0gW11cbiAgdmlzaXRNYXJrZG93bihwYXJzZU1hcmtkb3duKHNvdXJjZSksIChub2RlKSA9PiB7XG4gICAgaWYgKG5vZGUudHlwZSAhPT0gJ2h0bWwnIHx8IG5vZGUucG9zaXRpb24/LnN0YXJ0Lm9mZnNldCA9PT0gdW5kZWZpbmVkKSByZXR1cm5cbiAgICBsZXQgY3Vyc29yID0gMFxuICAgIHdoaWxlICh0cnVlKSB7XG4gICAgICBjb25zdCBzdGFydCA9IG5vZGUudmFsdWUuaW5kZXhPZignPCEtLScsIGN1cnNvcilcbiAgICAgIGlmIChzdGFydCA8IDApIGJyZWFrXG4gICAgICBjb25zdCBjbG9zZSA9IG5vZGUudmFsdWUuaW5kZXhPZignLS0+Jywgc3RhcnQgKyAnPCEtLScubGVuZ3RoKVxuICAgICAgY29uc3QgZW5kID0gY2xvc2UgPCAwID8gbm9kZS52YWx1ZS5sZW5ndGggOiBjbG9zZSArICctLT4nLmxlbmd0aFxuICAgICAgY29tbWVudHMucHVzaChbbm9kZS5wb3NpdGlvbi5zdGFydC5vZmZzZXQgKyBzdGFydCwgbm9kZS5wb3NpdGlvbi5zdGFydC5vZmZzZXQgKyBlbmRdKVxuICAgICAgY3Vyc29yID0gZW5kXG4gICAgfVxuICB9KVxuXG4gIGNvbnN0IHJhbmdlcyA9IG5ldyBNYXA8bnVtYmVyLCBDb2x1bW5SYW5nZVtdPigpXG4gIGxldCBsaW5lT2Zmc2V0ID0gMFxuICByYXdMaW5lcy5mb3JFYWNoKChyYXcsIGluZGV4KSA9PiB7XG4gICAgY29uc3QgbGluZUVuZCA9IGxpbmVPZmZzZXQgKyByYXcubGVuZ3RoXG4gICAgZm9yIChjb25zdCBbc3RhcnQsIGVuZF0gb2YgY29tbWVudHMpIHtcbiAgICAgIGNvbnN0IGZyb20gPSBNYXRoLm1heChzdGFydCwgbGluZU9mZnNldClcbiAgICAgIGNvbnN0IHRvID0gTWF0aC5taW4oZW5kLCBsaW5lRW5kKVxuICAgICAgY29uc3QgY292ZXJzRW1wdHlMaW5lID0gcmF3Lmxlbmd0aCA9PT0gMCAmJiBzdGFydCA8PSBsaW5lT2Zmc2V0ICYmIGVuZCA+IGxpbmVPZmZzZXRcbiAgICAgIGlmIChmcm9tIDwgdG8gfHwgY292ZXJzRW1wdHlMaW5lKSB7XG4gICAgICAgIGNvbnN0IGxpbmVSYW5nZXMgPSByYW5nZXMuZ2V0KGluZGV4ICsgMSkgPz8gW11cbiAgICAgICAgbGluZVJhbmdlcy5wdXNoKFtmcm9tIC0gbGluZU9mZnNldCwgdG8gLSBsaW5lT2Zmc2V0XSlcbiAgICAgICAgcmFuZ2VzLnNldChpbmRleCArIDEsIGxpbmVSYW5nZXMpXG4gICAgICB9XG4gICAgfVxuICAgIGxpbmVPZmZzZXQgPSBsaW5lRW5kICsgMVxuICB9KVxuICByZXR1cm4gcmFuZ2VzXG59XG5cbi8qKiBXaGV0aGVyIGEgc291cmNlIGxpbmUgcmV0YWlucyBub24td2hpdGVzcGFjZSB0ZXh0IGFmdGVyIEhUTUwgY29tbWVudHMgZGlzYXBwZWFyLiAqL1xuZnVuY3Rpb24gaGFzUmVuZGVyZWRUZXh0T3V0c2lkZUNvbW1lbnRzKHJhdzogc3RyaW5nLCByYW5nZXM6IHJlYWRvbmx5IENvbHVtblJhbmdlW10gfCB1bmRlZmluZWQpOiBib29sZWFuIHtcbiAgaWYgKHJhbmdlcyA9PT0gdW5kZWZpbmVkKSByZXR1cm4gdHJ1ZVxuICBsZXQgY3Vyc29yID0gMFxuICBsZXQgdmlzaWJsZSA9ICcnXG4gIGZvciAoY29uc3QgW3N0YXJ0LCBlbmRdIG9mIFsuLi5yYW5nZXNdLnNvcnQoKGxlZnQsIHJpZ2h0KSA9PiBsZWZ0WzBdIC0gcmlnaHRbMF0pKSB7XG4gICAgdmlzaWJsZSArPSByYXcuc2xpY2UoY3Vyc29yLCBzdGFydClcbiAgICBjdXJzb3IgPSBNYXRoLm1heChjdXJzb3IsIGVuZClcbiAgfVxuICB2aXNpYmxlICs9IHJhdy5zbGljZShjdXJzb3IpXG4gIHJldHVybiB2aXNpYmxlLnRyaW0oKS5sZW5ndGggPiAwXG59XG5cbi8qKlxuICogUmV0dXJuIHNvdXJjZSBsaW5lcyBvdXRzaWRlIGNvZGUgYmxvY2tzIGFuZCBIVE1MIGNvbW1lbnRzLlxuICogQHBhcmFtIHNvdXJjZSAtIE1hcmtkb3duIHNvdXJjZSB3aG9zZSBwcm9zZSBzaG91bGQgYmUgcmV0YWluZWQgdmVyYmF0aW0uXG4gKiBAcmV0dXJucyB1bmZlbmNlZCBsaW5lcyB3aXRoIHRoZWlyIG9yaWdpbmFsIDEtYmFzZWQgbG9jYXRpb25zLlxuICovXG5leHBvcnQgZnVuY3Rpb24gbWFya2Rvd25Qcm9zZUxpbmVzKHNvdXJjZTogc3RyaW5nKTogTWFya2Rvd25Qcm9zZUxpbmVbXSB7XG4gIGNvbnN0IHJhd0xpbmVzID0gc291cmNlLnNwbGl0KCdcXG4nKVxuICBjb25zdCBjb21tZW50cyA9IGh0bWxDb21tZW50UmFuZ2VzKHNvdXJjZSwgcmF3TGluZXMpXG4gIGNvbnN0IGZlbmNlZCA9IG5ldyBTZXQ8bnVtYmVyPigpXG4gIHZpc2l0TWFya2Rvd24ocGFyc2VNYXJrZG93bihzb3VyY2UpLCAobm9kZSkgPT4ge1xuICAgIGlmIChub2RlLnR5cGUgIT09ICdjb2RlJyB8fCBub2RlLnBvc2l0aW9uID09PSB1bmRlZmluZWQpIHJldHVyblxuICAgIGZvciAobGV0IGxpbmUgPSBub2RlLnBvc2l0aW9uLnN0YXJ0LmxpbmU7IGxpbmUgPD0gbm9kZS5wb3NpdGlvbi5lbmQubGluZTsgbGluZSArPSAxKSBmZW5jZWQuYWRkKGxpbmUpXG4gIH0pXG4gIGNvbnN0IGtlcHQ6IE1hcmtkb3duUHJvc2VMaW5lW10gPSBbXVxuICByYXdMaW5lcy5mb3JFYWNoKChyYXcsIGkpID0+IHtcbiAgICBpZiAoZmVuY2VkLmhhcyhpICsgMSkpIHJldHVyblxuICAgIGlmIChoYXNSZW5kZXJlZFRleHRPdXRzaWRlQ29tbWVudHMocmF3LCBjb21tZW50cy5nZXQoaSArIDEpKSkge1xuICAgICAga2VwdC5wdXNoKHsgaW5kZXg6IGkgKyAxLCByYXcgfSlcbiAgICB9XG4gIH0pXG4gIHJldHVybiBrZXB0XG59XG4iXSwKICAibWFwcGluZ3MiOiAiO0FBRUEsU0FBUyxnQkFB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LG9CQUFJLElBQW9CO0FBQy9DLFNBQUcsU0FBUyxNQUFNLFFBQVEsSUFBSSxTQUFTO0FBQ3JDLGNBQU0sQ0FBQyxRQUFRLEtBQUssSUFBSTtBQUN4QixjQUFNLFFBQVEsT0FBTyxLQUFLO0FBQzFCLFlBQUksVUFBVSxPQUFXLE9BQU0sSUFBSSxNQUFNLGtEQUFrRDtBQUUzRixZQUFJLENBQUMsV0FBVyxLQUFLLEVBQUUsU0FBUyxNQUFNLEtBQUssS0FBSyxFQUFFLE1BQU0sT0FBTyxDQUFDLEVBQUUsQ0FBQyxLQUFLLEVBQUUsRUFBRyxRQUFPLFlBQVksR0FBRyxJQUFJO0FBQ3ZHLFlBQUksUUFBUSxJQUFJLE9BQU8sS0FBSyxNQUFNLE9BQVcsUUFBTyxZQUFZLEdBQUcsSUFBSTtBQUV2RSxZQUFJLFFBQVEsSUFBSSxhQUFhLGFBQWMsUUFBTyxZQUFZLEdBQUcsSUFBSTtBQUNyRSxjQUFNLE1BQU0sS0FBSyxVQUFVLENBQUMsTUFBTSxTQUFTLE1BQU0sTUFBTSxNQUFNLFFBQVEsTUFBTSxLQUFLLENBQUM7QUFDakYsY0FBTSxTQUFTLGVBQWUsSUFBSSxHQUFHO0FBQ3JDLFlBQUksV0FBVyxPQUFXLFFBQU87QUFDakMsY0FBTSxPQUFPLFlBQVksR0FBRyxJQUFJO0FBQ2hDLHVCQUFlLElBQUksS0FBSyxJQUFJO0FBQzVCLGVBQU87QUFBQSxNQUNUO0FBQUEsSUFDRjtBQUFBLEVBQ0Y7QUFBQSxFQUNBLFNBQVMsQ0FBQztBQUFBLEVBQ1YsYUFBYTtBQUNmLENBQUM7IiwKICAibmFtZXMiOiBbInJlYWRGaWxlU3luYyIsICJ3cml0ZUZpbGVTeW5jIiwgInJlc29sdmUiLCAiZnJvbU1hcmtkb3duIiwgImdmbUZyb21NYXJrZG93biIsICJnZm0iLCAibG9jYWxpemVkIiwgImZyb21NYXJrZG93biIsICJnZm0iLCAiZ2ZtRnJvbU1hcmtkb3duIiwgIl9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lIiwgImRldmVsb3AiLCAicmVmZXJlbmNlIiwgInJlYWRGaWxlU3luYyIsICJyZXNvbHZlIiwgIl9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lIiwgIndyaXRlRmlsZVN5bmMiXQp9Cg==

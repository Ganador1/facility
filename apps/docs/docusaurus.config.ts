import type * as Preset from "@docusaurus/preset-classic";
import type { Config } from "@docusaurus/types";
import { themes } from "prism-react-renderer";

const config: Config = {
  title: "facility",
  tagline: "The platform that governs your AI SDLC.",
  favicon: "img/favicon.ico",
  url: "https://facility.theagilemonkeys.com",
  baseUrl: "/",
  organizationName: "theam",
  projectName: "facility",
  onBrokenLinks: "throw",
  markdown: { hooks: { onBrokenMarkdownLinks: "throw" } },
  i18n: { defaultLocale: "en", locales: ["en"] },

  presets: [
    [
      "classic",
      {
        docs: {
          routeBasePath: "/",
          sidebarPath: "./sidebars.ts",
          editUrl: "https://github.com/theam/facility/tree/main/apps/docs/",
        },
        blog: false,
        theme: { customCss: "./src/css/custom.css" },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    colorMode: {
      defaultMode: "dark",
      disableSwitch: true,
      respectPrefersColorScheme: false,
    },
    navbar: {
      title: "facility.",
      items: [
        { type: "docSidebar", sidebarId: "docs", position: "left", label: "docs" },
        { href: "https://github.com/theam/facility", label: "github", position: "right" },
      ],
    },
    footer: {
      style: "dark",
      copyright: `An initiative by <a href="https://theagilemonkeys.com">The Agile Monkeys</a>`,
    },
    prism: {
      theme: themes.vsDark,
      additionalLanguages: ["bash", "json", "yaml", "docker"],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;

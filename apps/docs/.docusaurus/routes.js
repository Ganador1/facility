import React from 'react';
import ComponentCreator from '@docusaurus/ComponentCreator';

export default [
  {
    path: '/',
    component: ComponentCreator('/', 'd1f'),
    routes: [
      {
        path: '/',
        component: ComponentCreator('/', '3b9'),
        routes: [
          {
            path: '/',
            component: ComponentCreator('/', '309'),
            routes: [
              {
                path: '/concepts/gateway-and-cost',
                component: ComponentCreator('/concepts/gateway-and-cost', 'f50'),
                exact: true,
                sidebar: "docs"
              },
              {
                path: '/concepts/inbox',
                component: ComponentCreator('/concepts/inbox', 'a1a'),
                exact: true,
                sidebar: "docs"
              },
              {
                path: '/concepts/knowledge',
                component: ComponentCreator('/concepts/knowledge', '75c'),
                exact: true,
                sidebar: "docs"
              },
              {
                path: '/concepts/projects-and-governance',
                component: ComponentCreator('/concepts/projects-and-governance', 'a0e'),
                exact: true,
                sidebar: "docs"
              },
              {
                path: '/concepts/registry',
                component: ComponentCreator('/concepts/registry', '636'),
                exact: true,
                sidebar: "docs"
              },
              {
                path: '/concepts/sandboxes',
                component: ComponentCreator('/concepts/sandboxes', 'b8d'),
                exact: true,
                sidebar: "docs"
              },
              {
                path: '/concepts/the-loop',
                component: ComponentCreator('/concepts/the-loop', '04f'),
                exact: true,
                sidebar: "docs"
              },
              {
                path: '/concepts/watchtower',
                component: ComponentCreator('/concepts/watchtower', 'f7d'),
                exact: true,
                sidebar: "docs"
              },
              {
                path: '/guides/existing-repo',
                component: ComponentCreator('/guides/existing-repo', '9b8'),
                exact: true,
                sidebar: "docs"
              },
              {
                path: '/guides/kickstart',
                component: ComponentCreator('/guides/kickstart', '4ff'),
                exact: true,
                sidebar: "docs"
              },
              {
                path: '/guides/tam-os',
                component: ComponentCreator('/guides/tam-os', '0b5'),
                exact: true,
                sidebar: "docs"
              },
              {
                path: '/reference/api',
                component: ComponentCreator('/reference/api', '4d1'),
                exact: true,
                sidebar: "docs"
              },
              {
                path: '/reference/cli',
                component: ComponentCreator('/reference/cli', '578'),
                exact: true,
                sidebar: "docs"
              },
              {
                path: '/reference/mcp',
                component: ComponentCreator('/reference/mcp', '136'),
                exact: true,
                sidebar: "docs"
              },
              {
                path: '/reference/security',
                component: ComponentCreator('/reference/security', '4ea'),
                exact: true,
                sidebar: "docs"
              },
              {
                path: '/self-host/aws',
                component: ComponentCreator('/self-host/aws', '361'),
                exact: true,
                sidebar: "docs"
              },
              {
                path: '/self-host/production',
                component: ComponentCreator('/self-host/production', 'dd1'),
                exact: true,
                sidebar: "docs"
              },
              {
                path: '/self-host/quickstart',
                component: ComponentCreator('/self-host/quickstart', 'f47'),
                exact: true,
                sidebar: "docs"
              },
              {
                path: '/',
                component: ComponentCreator('/', 'bea'),
                exact: true,
                sidebar: "docs"
              }
            ]
          }
        ]
      }
    ]
  },
  {
    path: '*',
    component: ComponentCreator('*'),
  },
];

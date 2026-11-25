import { defineConfig } from 'vitepress';

const repositoryName = process.env.GITHUB_REPOSITORY?.split('/')[1];
const base = process.env.GITHUB_ACTIONS === 'true' && repositoryName
    ? `/${repositoryName}/`
    : '/';

export default defineConfig({
    title: 'AgentKit',
    description: 'A TypeScript agent toolkit built on the Vercel AI SDK.',
    base,
    themeConfig: {
        nav: [
            { text: 'Guides', link: '/guide/getting-started' },
            { text: 'GitHub', link: 'https://github.com/Therosin/AgentKit' },
        ],
        sidebar: [
            {
                text: 'Build with AgentKit',
                items: [
                    { text: 'Make your first agent', link: '/guide/getting-started' },
                    { text: 'Build a tool workflow', link: '/guide/tool-workflows' },
                    { text: 'Keep values private', link: '/guide/secure-values' },
                    { text: 'Ask for a typed answer', link: '/guide/structured-output' },
                    { text: 'Show progress', link: '/guide/streaming' },
                    { text: 'Personalize a prompt', link: '/guide/prompts-and-context' },
                    { text: 'Choose a model provider', link: '/guide/models-and-providers' },
                ],
            },
            {
                text: 'Contribute',
                items: [
                    { text: 'Development', link: '/guide/development' },
                ],
            },
        ],
        socialLinks: [
            { icon: 'github', link: 'https://github.com/Therosin/AgentKit' },
        ],
    },
});

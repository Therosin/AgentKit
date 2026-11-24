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
            { text: 'Guide', link: '/guide/development' },
            { text: 'GitHub', link: 'https://github.com/Therosin/AgentKit' },
        ],
        sidebar: [
            {
                text: 'Project',
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

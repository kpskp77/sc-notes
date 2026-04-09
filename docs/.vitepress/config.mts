import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'SystemC 学习笔记',
  description: 'SystemC 语言核心概念与仿真调度机制',
  appearance: 'dark',
  base: '/sc-notes/',
  cleanUrls: false,
  trailingSlash: true,
  themeConfig: {
    nav: [
      { text: '首页', link: '/' },
      { text: '调度语义', link: '/schedule' },
      { text: '进程通信', link: '/communication' },
      { text: '仿真流程', link: '/process' }
    ],
    sidebar: [
      {
        text: '目录',
        items: [
          { text: '调度语义', link: '/schedule' },
          { text: '进程通信', link: '/communication' },
          { text: '仿真流程', link: '/process' }
        ]
      }
    ],
    socialLinks: [
      { icon: 'github', link: 'https://github.com/kpskp77/sc-notes' }
    ],
    footer: {
      message: 'MIT License',
      copyright: 'Copyright © 2024 Carousel'
    }
  },
})
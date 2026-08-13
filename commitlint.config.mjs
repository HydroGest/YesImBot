/**
 * commitlint 配置文件
 * 规范 commit message，确保提交记录结构化、统一
 *
 * 参考规范： https://www.conventionalcommits.org/zh-hans/v1.0.0/
 *
 * 提交格式：
 * <type>(<scope>): <subject>
 *
 * 例子：
 * feat(core): 新增用户登录接口
 * fix(api): 修复数据返回格式错误
 */

export default {
    extends: ["@commitlint/config-conventional"],

    rules: {
        /**
         * type-enum: 限制 type 的可选值，防止随意命名
         * 级别：
         *   0 = 关闭规则
         *   1 = 警告
         *   2 = 错误（阻止提交）
         */
        "type-enum": [
            1,
            "always",
            [
                "build",     // 构建相关修改（构建脚本、外部依赖等）
                "ci",        // CI/CD 配置修改
                "docs",      // 文档修改
                "feat",      // 新增功能
                "fix",       // 修复 Bug
                "perf",      // 性能优化
                "refactor",  // 代码重构（没有新功能或修复 Bug）
                "revert",    // 回滚提交
                "style",     // 代码样式修改（空格、缩进、格式等，不影响运行）
                "test",      // 测试相关改动
                "wip",       // 开发中（Work in progress）
                "merge",     // 分支合并
                "chore"      // 杂务（构建过程、辅助工具等的变动）
            ],
        ],

        /**
         * subject-case: 限制 subject（变更描述）的格式
         * 这里设置为禁止首字母大写，保持简洁
         */
        "subject-case": [1, "always", "lower-case"],

        /**
         * scope-case: 限制 scope 的格式，这里强制小写
         */
        "scope-case": [1, "always", "lower-case"],

        /**
         * header-max-length: 限制头部信息最大长度（type+scope+subject）
         * 这里参考 GitHub 推荐值 72
         */
        "header-max-length": [1, "always", 72],

        "body-max-line-length": [1, "always", 100],
    },

    prompt: {
        // 自定义快捷别名
        alias: {
            fd: 'docs: 修正文档错误'
        },

        // 提示信息
        messages: {
            type: '请选择提交类型:',
            scope: '请选择提交范围 (可选):',
            customScope: '请输入自定义的提交范围:',
            subject: '请简要描述本次提交的变更:\n',
            body: '请输入详细描述 (可选)，使用 "|" 表示换行:\n',
            breaking: '列举重大变更 (可选)，使用 "|" 表示换行:\n',
            footer: '列举已关闭的 ISSUES (可选)，例如: #31, #34:\n',
            confirmCommit: '确认提交吗?',
        },

        // 可选类型
        types: [
            { value: 'feat', name: 'feat:     新增功能' },
            { value: 'fix', name: 'fix:      修复缺陷' },
            { value: 'docs', name: 'docs:     文档变更' },
            { value: 'style', name: 'style:    代码格式（不影响运行逻辑）' },
            { value: 'refactor', name: 'refactor: 代码重构（无功能新增或缺陷修复）' },
            { value: 'perf', name: 'perf:     性能优化' },
            { value: 'test', name: 'test:     添加或修改测试' },
            { value: 'build', name: 'build:    构建或依赖变更' },
            { value: 'ci', name: 'ci:       CI/CD 配置修改' },
            { value: 'chore', name: 'chore:    日常事务（构建过程或工具修改）' },
            { value: 'revert', name: 'revert:   回滚提交' },
            { value: 'wip', name: 'wip:      开发中' },
            { value: 'merge', name: 'merge:    合并分支' }
        ],

        // 不使用 Emoji
        useEmoji: false,

        // type 对齐方式
        emojiAlign: 'left',

        // 可选作用域
        scopes: ['root', 'core', 'mcp', 'executor', 'daily', 'favor', 'sticker'],

        // 是否可添加自定义 scope
        allowCustomScopes: true,
        allowEmptyScopes: true,

        // 非兼容性变更提示，仅在以下类型可选
        allowBreakingChanges: ['feat', 'fix'],

        // 其他配置
        breaklineChar: '|',
        skipQuestions: [],
        issuePrefixes: [
            { value: 'closed', name: 'closed:  已处理的 ISSUE' }
        ],
        allowCustomIssuePrefix: true,
        allowEmptyIssuePrefix: true,
        confirmColorize: true,
    },
};

import antfu from "@antfu/eslint-config";

export default antfu({
    // type: "lib",

    ignores: [
        "**/fixtures",
    ],

    gitignore: true,

    stylistic: {
        indent: 4,
        quotes: "double",
        semi: true,
    },

    typescript: true,
    vue: true,

    jsonc: false,
    yaml: false,

    rules: {
        "no-console": "off",
        "import/no-duplicates": "off",
        "unused-imports/no-unused-vars": "off",
        "ts/no-empty-object-type": "off",
        "ts/no-redeclare": "warn",
        "style/arrow-parens": "off",
        "style/brace-style": "off",
    },
});

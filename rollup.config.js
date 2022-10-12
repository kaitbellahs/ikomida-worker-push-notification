import autoExternal from 'rollup-plugin-auto-external';
import tsPlugin from '@rollup/plugin-typescript';
import resolve from "@rollup/plugin-node-resolve";
import { terser } from 'rollup-plugin-terser';
import json from '@rollup/plugin-json';
import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const pkg = require('./package.json')
const tsconfig = require('./tsconfig.json')

export default [
    {
        input: "src/worker.ts",
        output: [
            {
                file: pkg.module,
                format: 'es',
                sourcemap: true,
            },
        ],
        plugins: [
            autoExternal(),
            tsPlugin(tsconfig),
            resolve({
                preferBuiltins: true
            }),
            json(),
            terser()
        ],
    },
];
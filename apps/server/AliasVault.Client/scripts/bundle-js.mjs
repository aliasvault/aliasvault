/**
 * Bundle and minify JavaScript files for AliasVault.Client
 * Uses esbuild to concatenate and minify global scripts that attach to window object.
 */
import * as esbuild from 'esbuild';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isWatch = process.argv.includes('--watch');
const isDev = process.argv.includes('--dev');

// Files to bundle (order matters - dependencies first)
const inputFiles = [
    'wwwroot/js/encryption-utils.js',
    'wwwroot/js/utilities.js',
    'wwwroot/lib/qrcode.min.js',
    'wwwroot/js/rustCoreInterop.js',
];

const outputFile = 'wwwroot/js/bundle.min.js';
const rootDir = path.resolve(__dirname, '..');

async function build() {
    // Read and concatenate all input files
    let concatenated = '';
    for (const file of inputFiles) {
        const filePath = path.join(rootDir, file);
        const content = fs.readFileSync(filePath, 'utf-8');
        concatenated += `// Source: ${file}\n${content}\n\n`;
    }

    // Write concatenated file to temp location
    const tempFile = path.join(rootDir, 'wwwroot/js/.bundle-temp.js');
    fs.writeFileSync(tempFile, concatenated);

    try {
        // Use esbuild to minify
        const result = await esbuild.build({
            entryPoints: [tempFile],
            outfile: path.join(rootDir, outputFile),
            bundle: false,
            minify: !isDev,
            sourcemap: isDev ? 'inline' : false,
            target: 'es2020',
            write: true,
        });

        console.log(`✓ Bundled ${inputFiles.length} files to ${outputFile}${isDev ? ' (dev mode)' : ''}`);

        if (result.warnings.length > 0) {
            console.warn('Warnings:', result.warnings);
        }
    } finally {
        // Clean up temp file
        if (fs.existsSync(tempFile)) {
            fs.unlinkSync(tempFile);
        }
    }
}

async function watch() {
    console.log('Watching for changes...');

    // Initial build
    await build();

    // Watch input files
    for (const file of inputFiles) {
        const filePath = path.join(rootDir, file);
        fs.watch(filePath, async (eventType) => {
            if (eventType === 'change') {
                console.log(`\nFile changed: ${file}`);
                await build();
            }
        });
    }
}

if (isWatch) {
    watch().catch(console.error);
} else {
    build().catch((err) => {
        console.error(err);
        process.exit(1);
    });
}

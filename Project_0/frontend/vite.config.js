import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
export default defineConfig(function () { return ({
    plugins: [react()],
    resolve: {
        alias: {
            '@': path.resolve(__dirname, 'src'),
            '@shared': path.resolve(__dirname, '../shared')
        }
    },
    server: {
        fs: {
            allow: [path.resolve(__dirname), path.resolve(__dirname, '../shared')]
        }
    }
}); });

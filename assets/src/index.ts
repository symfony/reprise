import type { UnpluginFactory, UnpluginInstance } from 'unplugin';
import type { Options } from './types';
import * as process from 'node:process';
import { createUnplugin } from 'unplugin';
import { rsbuildHooks } from './bundlers/rsbuild';
import { viteHooks } from './bundlers/vite';
import { normalizeOptions } from './core/options';
import {
    generateControllersModule,
    RESOLVED_VIRTUAL_CONTROLLERS_ID,
    STIMULUS_NOT_ENABLED_MESSAGE,
    stimulusWatchFiles,
    VIRTUAL_CONTROLLERS_ID,
} from './core/stimulus';

export const unpluginFactory: UnpluginFactory<Options | undefined> = (options, _meta) => {
    const cwd = process.cwd();
    const resolved = normalizeOptions(options, cwd);
    const state = { isDev: false };

    return {
        name: '@symfony/reprise',

        // Shared Stimulus virtual module: unplugin applies these universal hooks to Vite and forwards
        // them to Rspack (via `api.modifyRspackConfig`), so one implementation serves both bundlers. The
        // `\0` prefix sidesteps Rspack's URI-scheme rejection of a raw `virtual:` id.
        //
        // On Rspack, unplugin attaches its `load` loader to every module whose `loadInclude` passes
        // (and retypes it `javascript/auto`). Without this gate it would match binary assets too —
        // the loader is not `raw`, so it re-emits them as UTF-8 strings and corrupts images/fonts in
        // dev. Restrict it to the virtual id so real files are never touched.
        loadInclude: (id) => id.includes(VIRTUAL_CONTROLLERS_ID),
        resolveId(id) {
            if (id !== VIRTUAL_CONTROLLERS_ID) return;
            // Imported unconditionally by `startStimulusApp()`; fail clearly when the feature is off.
            if (!resolved.stimulus) throw new Error(STIMULUS_NOT_ENABLED_MESSAGE);
            return RESOLVED_VIRTUAL_CONTROLLERS_ID;
        },

        load(id) {
            if (!resolved.stimulus || id !== RESOLVED_VIRTUAL_CONTROLLERS_ID) return;
            for (const file of stimulusWatchFiles(resolved.stimulus)) this.addWatchFile(file);
            const native = this.getNativeBuildContext?.();
            if (native?.framework === 'rspack')
                for (const dir of Object.values(resolved.stimulus.controllersDirs))
                    native.loaderContext?.addContextDependency(dir);
            return generateControllersModule(resolved.stimulus, cwd, state.isDev);
        },

        vite: viteHooks(resolved, state),
        rsbuild: rsbuildHooks(resolved, state),
    };
};

export const unplugin: UnpluginInstance<Options | undefined> = /* #__PURE__ */ createUnplugin<Options | undefined>(
    unpluginFactory
);

export default unplugin;

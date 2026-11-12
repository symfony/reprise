<?php

/*
 * This file is part of the Symfony package.
 *
 * (c) Fabien Potencier <fabien@symfony.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

namespace Symfony\Reprise\Asset;

use Symfony\Component\Asset\Packages;
use Symfony\Component\HttpFoundation\RequestStack;
use Symfony\Component\WebLink\GenericLinkProvider;
use Symfony\Component\WebLink\Link;
use Symfony\Contracts\EventDispatcher\EventDispatcherInterface;
use Symfony\Contracts\Service\ResetInterface;
use Symfony\Reprise\Event\RenderAssetTagEvent;

/**
 * Renders the <script>/<link> tags for an entry, resolving each entrypoints.json reference through
 * Symfony's asset Packages (ADR 0001) and adding SRI integrity/crossorigin when present.
 *
 * @author Hugo Alliaume <hugo@alliau.me>
 *
 * @internal
 */
final class TagRenderer implements ResetInterface
{
    /**
     * HMR client URLs already injected this request, kept as a set so each dev server (there is one per
     * build) injects its client exactly once, even when several builds render on the same page.
     *
     * @var array<string, true>
     */
    private array $injectedClients = [];

    /**
     * @param array<string, bool|string> $scriptAttributes
     * @param array<string, bool|string> $linkAttributes
     */
    public function __construct(
        private readonly EntrypointsLookupCollectionInterface $collection,
        private readonly Packages $packages,
        private readonly ?RequestStack $requestStack = null,
        private readonly ?string $defaultPackage = null,
        private readonly string|false $crossorigin = false,
        private readonly bool $preload = true,
        private readonly array $scriptAttributes = [],
        private readonly array $linkAttributes = [],
        private readonly ?EventDispatcherInterface $eventDispatcher = null,
    ) {
    }

    /**
     * @param array<string, bool|string> $attributes per-call attributes, merged last so they win over the
     *                                               configured script_attributes (integrity/crossorigin stay authoritative)
     */
    public function renderScriptTags(string $entryName, ?string $packageName = null, ?string $build = null, array $attributes = []): string
    {
        $lookup = $this->collection->getEntrypointsLookup($build);
        $integrity = $lookup->getIntegrityData();
        $scriptDefaults = $attributes + $this->scriptAttributes;
        $tags = $this->devClientTags($lookup->getDevServer(), $scriptDefaults);

        foreach ($lookup->getPreloadFiles($entryName) as $reference) {
            $url = $this->url($reference, $packageName);
            // Only the scripts' nonce applies: CSP checks a modulepreload against script-src like the scripts.
            $tagAttributes = ['rel' => 'modulepreload', 'href' => $url] + array_intersect_key($scriptDefaults, ['nonce' => true]);
            $tags[] = $this->fileTag(RenderAssetTagEvent::TYPE_MODULEPRELOAD, $url, $tagAttributes, $integrity[$reference] ?? null, 'modulepreload');
        }

        foreach ($lookup->getJavaScriptFiles($entryName) as $reference) {
            $url = $this->url($reference, $packageName);
            $tagAttributes = ['src' => $url, 'type' => 'module'] + $scriptDefaults;
            // modulepreload, not `preload as=script`: the tag is a module, and a classic-script preload
            // mismatches its credentials/CORS mode so the browser discards it.
            $tags[] = $this->fileTag(RenderAssetTagEvent::TYPE_SCRIPT, $url, $tagAttributes, $integrity[$reference] ?? null, 'modulepreload');
        }

        return implode('', $tags);
    }

    /**
     * @param array<string, bool|string> $attributes per-call attributes, merged last so they win over the
     *                                               configured link_attributes (integrity/crossorigin stay authoritative)
     */
    public function renderLinkTags(string $entryName, ?string $packageName = null, ?string $build = null, array $attributes = []): string
    {
        $lookup = $this->collection->getEntrypointsLookup($build);
        $integrity = $lookup->getIntegrityData();
        $tags = [];
        foreach ($lookup->getCssFiles($entryName) as $reference) {
            $url = $this->url($reference, $packageName);
            $tagAttributes = ['rel' => 'stylesheet', 'href' => $url] + $attributes + $this->linkAttributes;
            $tags[] = $this->fileTag(RenderAssetTagEvent::TYPE_LINK, $url, $tagAttributes, $integrity[$reference] ?? null, 'preload', 'style');
        }

        return implode('', $tags);
    }

    /**
     * @return list<string>
     */
    public function getJsFiles(string $entryName, ?string $packageName = null, ?string $build = null): array
    {
        return array_map(fn (string $r) => $this->url($r, $packageName), $this->collection->getEntrypointsLookup($build)->getJavaScriptFiles($entryName));
    }

    /**
     * @return list<string>
     */
    public function getCssFiles(string $entryName, ?string $packageName = null, ?string $build = null): array
    {
        return array_map(fn (string $r) => $this->url($r, $packageName), $this->collection->getEntrypointsLookup($build)->getCssFiles($entryName));
    }

    public function entryExists(string $entryName, ?string $build = null): bool
    {
        return $this->collection->getEntrypointsLookup($build)->entryExists($entryName);
    }

    public function reset(): void
    {
        $this->injectedClients = [];
    }

    /**
     * @param array<string, bool|string> $scriptDefaults
     *
     * @return list<string>
     */
    private function devClientTags(?DevServer $devServer, array $scriptDefaults): array
    {
        if (null === $devServer || null === $devServer->client || isset($this->injectedClients[$devServer->client])) {
            return [];
        }

        $clientAttributes = ['type' => 'module', 'src' => $devServer->client] + $scriptDefaults;
        $tags = [$this->tag(RenderAssetTagEvent::TYPE_SCRIPT, $clientAttributes)];
        if (null !== $devServer->reactRefresh) {
            $preambleAttributes = ['type' => 'module'] + $scriptDefaults;
            $tags[] = $this->tag(RenderAssetTagEvent::TYPE_SCRIPT, $preambleAttributes, $this->reactRefreshPreamble($devServer->reactRefresh));
        }
        $this->injectedClients[$devServer->client] = true;

        return $tags;
    }

    /**
     * The inner body of Vite's React Fast Refresh preamble. `@vitejs/plugin-react` normally injects this
     * into the HTML itself, but cannot when Symfony renders the page (backend integration), so we render
     * it here before the entry, wrapped in a <script type="module"> by tag(). See
     * https://vite.dev/guide/backend-integration.
     */
    private function reactRefreshPreamble(string $reactRefreshUrl): string
    {
        return \sprintf(
            <<<'JS'

                import RefreshRuntime from "%s";
                RefreshRuntime.injectIntoGlobalHook(window);
                window.$RefreshReg$ = () => {};
                window.$RefreshSig$ = () => (type) => type;
                window.__vite_plugin_react_preamble_installed__ = true;

                JS,
            htmlspecialchars($reactRefreshUrl, \ENT_QUOTES),
        );
    }

    private function url(string $reference, ?string $packageName): string
    {
        return $this->packages->getUrl($reference, $packageName ?? $this->defaultPackage);
    }

    /**
     * @param array<string, bool|string> $attributes
     */
    private function fileTag(string $type, string $url, array $attributes, ?string $integrity, string $preloadRel, ?string $preloadAs = null): string
    {
        if (null !== $integrity) {
            $attributes['integrity'] = $integrity;
            $attributes['crossorigin'] = false === $this->crossorigin ? 'anonymous' : $this->crossorigin;
        }
        $tag = $this->tag($type, $attributes);
        $this->preload($url, $preloadRel, $preloadAs, $attributes);

        return $tag;
    }

    /**
     * @param array<string, bool|string> $tagAttributes
     */
    private function preload(string $url, string $rel, ?string $as, array $tagAttributes): void
    {
        if (!$this->preload || null === $this->requestStack || !class_exists(GenericLinkProvider::class)) {
            return;
        }

        $request = $this->requestStack->getCurrentRequest();
        if (null === $request) {
            return;
        }

        $link = new Link($rel, $url);
        if (null !== $as) {
            $link = $link->withAttribute('as', $as);
        }
        // Mirror the final tag, or the browser discards a mismatched preload and a nonce-based CSP blocks it.
        foreach (['integrity', 'crossorigin', 'nonce'] as $name) {
            if (false !== ($tagAttributes[$name] ?? false)) {
                $link = $link->withAttribute($name, $tagAttributes[$name]);
            }
        }

        $linkProvider = $request->attributes->get('_links');
        if (!$linkProvider instanceof GenericLinkProvider) {
            $linkProvider = new GenericLinkProvider();
        }
        $request->attributes->set('_links', $linkProvider->withLink($link));
    }

    /**
     * @param array<string, bool|string> $attributes
     */
    private function tag(string $type, array &$attributes, ?string $inlineBody = null): string
    {
        if (null !== $this->eventDispatcher) {
            $event = $this->eventDispatcher->dispatch(new RenderAssetTagEvent($type, $attributes));
            $attributes = $event->attributes;
        }

        return match ($type) {
            RenderAssetTagEvent::TYPE_LINK, RenderAssetTagEvent::TYPE_MODULEPRELOAD => \sprintf('<link %s>', $this->attributes($attributes)),
            default => \sprintf('<script %s>%s</script>', $this->attributes($attributes), $inlineBody ?? ''),
        };
    }

    /**
     * @param array<string, bool|string> $attributes
     */
    private function attributes(array $attributes): string
    {
        $parts = [];
        foreach ($attributes as $name => $value) {
            if (true === $value) {
                $parts[] = $name;
            } elseif (false !== $value) {
                $parts[] = $name.'="'.htmlspecialchars($value, \ENT_QUOTES).'"';
            }
        }

        return implode(' ', $parts);
    }
}

<?php

/*
 * This file is part of the Symfony package.
 *
 * (c) Fabien Potencier <fabien@symfony.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

namespace Symfony\Reprise\Tests\Asset;

use PHPUnit\Framework\TestCase;
use Symfony\Component\DependencyInjection\ServiceLocator;
use Symfony\Reprise\Asset\EntrypointsLookup;
use Symfony\Reprise\Asset\EntrypointsLookupCollection;
use Symfony\Reprise\Exception\UndefinedBuildException;

final class EntrypointsLookupCollectionTest extends TestCase
{
    private function lookup(): EntrypointsLookup
    {
        return new EntrypointsLookup(__DIR__.'/../fixtures/build/entrypoints.json');
    }

    public function testResolvesTheDefaultBuildWhenNoNameIsGiven(): void
    {
        $default = $this->lookup();
        $collection = new EntrypointsLookupCollection(
            new ServiceLocator(['_default' => static fn () => $default, 'admin' => fn () => $this->lookup()]),
            '_default',
        );

        $this->assertSame($default, $collection->getEntrypointsLookup());
        $this->assertSame($default, $collection->getEntrypointsLookup('_default'));
    }

    public function testResolvesANamedBuild(): void
    {
        $admin = $this->lookup();
        $collection = new EntrypointsLookupCollection(
            new ServiceLocator(['_default' => fn () => $this->lookup(), 'admin' => static fn () => $admin]),
            '_default',
        );

        $this->assertSame($admin, $collection->getEntrypointsLookup('admin'));
    }

    public function testThrowsForAnUnknownBuild(): void
    {
        $collection = new EntrypointsLookupCollection(
            new ServiceLocator(['_default' => fn () => $this->lookup()]),
            '_default',
        );

        $this->expectException(UndefinedBuildException::class);
        $collection->getEntrypointsLookup('does-not-exist');
    }

    public function testThrowsWhenNoBuildIsGivenAndThereIsNoDefault(): void
    {
        $collection = new EntrypointsLookupCollection(
            new ServiceLocator(['admin' => fn () => $this->lookup()]),
            null,
        );

        $this->expectException(UndefinedBuildException::class);
        $collection->getEntrypointsLookup();
    }
}

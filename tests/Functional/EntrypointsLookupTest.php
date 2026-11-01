<?php

/*
 * This file is part of the Symfony package.
 *
 * (c) Fabien Potencier <fabien@symfony.com>
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

namespace Symfony\Reprise\Tests\Functional;

use PHPUnit\Framework\TestCase;
use Symfony\Reprise\Asset\EntrypointsLookupInterface;
use Symfony\Reprise\Tests\Kernel\FunctionalAppKernel;
use Symfony\Reprise\Tests\Kernel\LookupConsumer;

final class EntrypointsLookupTest extends TestCase
{
    public function testTheLookupIsWiredFromConfigAndResolvesAnEntry(): void
    {
        $kernel = new FunctionalAppKernel(__DIR__.'/../fixtures/build');
        $kernel->boot();

        $lookup = $kernel->getContainer()->get(EntrypointsLookupInterface::class);

        $this->assertInstanceOf(EntrypointsLookupInterface::class, $lookup);
        $this->assertSame(['build/app-a1b2.js'], $lookup->getJavaScriptFiles('app'));
        $this->assertTrue($lookup->isProd());
    }

    public function testTheInterfaceIsAutowirableIntoUserServices(): void
    {
        $kernel = new FunctionalAppKernel(__DIR__.'/../fixtures/build');
        $kernel->boot();

        $consumer = $kernel->getContainer()->get(LookupConsumer::class);

        $this->assertInstanceOf(LookupConsumer::class, $consumer);
        $this->assertSame(['build/app-a1b2.js'], $consumer->lookup->getJavaScriptFiles('app'));
    }
}

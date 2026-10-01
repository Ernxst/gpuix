/// Exercises TanStack Router's real HeadContent through the native test renderer.

import React from "react"
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  HeadContent,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router"
import { afterEach, describe, expect, it } from "vitest"

import "../globals.js"
import { act, createTestRoot, isNativeTestRendererAvailable, type TestRoot } from "../testing.js"

const describeNative = isNativeTestRendererAvailable() ? describe : describe.skip

let screen: TestRoot | undefined

afterEach(() => {
  screen?.unmount()
  screen = undefined
})

async function expectRouteTitles(
  HeadContentComponent: React.ComponentType<React.ComponentProps<typeof HeadContent>>
) {
  function Root() {
    return (
      <>
        <HeadContentComponent />
        <Outlet />
      </>
    )
  }

  const rootRoute = createRootRoute({ component: Root })
  const firstRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "first",
    head: () => ({ meta: [{ title: "First route" }] }),
    component: () => <text>First route</text>,
  })
  const secondRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "second",
    head: () => ({ meta: [{ title: "Second route" }] }),
    component: () => <text>Second route</text>,
  })
  const router = createRouter({
    routeTree: rootRoute.addChildren([firstRoute, secondRoute]),
    history: createMemoryHistory({ initialEntries: ["/first"] }),
    isServer: false,
  })

  await router.load()
  screen = createTestRoot()
  screen.render(<RouterProvider router={router} />)
  expect(screen.renderer.getWindowTitle()).toBe("First route")

  await act(() => router.navigate({ to: "/second" }))
  expect(screen.renderer.getWindowTitle()).toBe("Second route")
}

describeNative("TanStack Router HeadContent", () => {
  it("sets the window title on initial and subsequent routes in development", async () => {
    await expectRouteTitles(HeadContent)
  })

  it("sets the window title on initial and subsequent routes in production", async () => {
    const entry = import.meta.resolve("@tanstack/react-router")
    const productionModule = await import(new URL("./HeadContent.js", entry).href)
    await expectRouteTitles(productionModule.HeadContent)
  })
})

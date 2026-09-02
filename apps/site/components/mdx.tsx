//
// What MDX can reach for.
//
// Every fact on this site that could rot is a COMPONENT rather than a paragraph: `<MainnetRecord/>`
// reads `evidence/*.json`, `<RefusedClaims/>` reads the protocol package's real list,
// `<SurfaceStatus/>` computes Markets and Launch from whether the evidence file has addresses in it.
//
import defaultMdxComponents from 'fumadocs-ui/mdx'
import { Step, Steps } from 'fumadocs-ui/components/steps'
import { Callout } from 'fumadocs-ui/components/callout'
import { Tab, Tabs } from 'fumadocs-ui/components/tabs'
import type { MDXComponents } from 'mdx/types'

import { MainnetRecord, RefusedClaims, SurfaceStatus, WhoSeesWhat } from './live'
import { GuideShot } from './guide-shot'

export function getMDXComponents(components?: MDXComponents) {
  return {
    ...defaultMdxComponents,
    Callout,
    GuideShot,
    Step,
    Steps,
    Tab,
    Tabs,
    MainnetRecord,
    RefusedClaims,
    SurfaceStatus,
    WhoSeesWhat,
    ...components,
  } satisfies MDXComponents
}

export const useMDXComponents = getMDXComponents

declare global {
  type MDXProvidedComponents = ReturnType<typeof getMDXComponents>
}

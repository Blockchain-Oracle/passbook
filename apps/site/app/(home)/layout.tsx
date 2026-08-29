// The landing page carries its own header and footer (`landing/SiteChrome.tsx`); Fumadocs' home
// chrome would put a second nav on top of it.
export default function Layout({ children }: LayoutProps<'/'>) {
  return <>{children}</>
}

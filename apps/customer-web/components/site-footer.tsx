export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="container row-between">
        <span>Utsavora is live in Greater Noida. Delhi NCR is next.</span>
        <span>
          Are you a caterer, decorator or photographer? <a href={`${process.env.NEXT_PUBLIC_VENDOR_PORTAL_URL ?? "http://localhost:3001"}/register`}>List your business</a>
        </span>
      </div>
    </footer>
  );
}

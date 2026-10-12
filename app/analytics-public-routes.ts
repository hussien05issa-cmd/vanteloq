const PUBLIC_MEASUREMENT_PATHS = new Set(["/", "/demo", "/help", "/pricing", "/contact", "/book-demo", "/custom-plan", "/cookies", "/data-processing", "/legal", "/privacy", "/subprocessors", "/terms", "/solutions", "/solutions/retail", "/solutions/dealerships", "/solutions/cafes", "/solutions/restaurants", "/integrations", "/integrations/square", "/integrations/lightspeed-r", "/tools", "/tools/cash-order-planner", "/tools/vehicle-holding-cost", "/about", "/about/editorial"]);

export function isPublicMeasurementPath(pathname: string) {
  return PUBLIC_MEASUREMENT_PATHS.has(pathname) || pathname === "/resources" || pathname.startsWith("/resources/") || pathname.startsWith("/features/");
}

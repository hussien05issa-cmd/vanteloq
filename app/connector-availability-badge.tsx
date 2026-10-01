import "./connector-availability-badge.css";

export default function ConnectorAvailabilityBadge({ available }: { available: boolean }) {
  return <span className={`connector-availability-sticker ${available ? "is-available" : "is-coming-soon"}`}>
    <span>{available ? "Available!" : "Coming Soon!"}</span>
  </span>;
}

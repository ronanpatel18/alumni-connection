import Link from "next/link";
import { toggleSaved } from "@/app/(member)/actions";
import { initialsFor, OPEN_TO_LABELS } from "@/lib/labels";
import { AvatarPhoto } from "./avatar-photo";
import { Icon } from "./icon";

export interface PersonSummary {
  id: string;
  full_name: string;
  current_title: string | null;
  organization_name: string | null;
  industry_name?: string | null;
  city: string | null;
  state: string | null;
  metro?: string | null;
  status: string;
  alumni_status?: string | null;
  photo_url?: string | null;
  open_to: string[] | null;
  grad_year: number | null;
  degree: string | null;
}


export const isConfirmed = (status: string) => status === "claimed" || status === "verified";

export function Avatar({ name, photoUrl, confirmed, size }: { name: string; photoUrl?: string | null; confirmed: boolean; size?: "small" | "large" }) {
  return (
    <span className={["avatar", confirmed ? "red" : "", size ?? ""].join(" ").trim()} aria-hidden="true">
      {initialsFor(name)}
      {photoUrl && <AvatarPhoto src={photoUrl} />}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  return isConfirmed(status) ? (
    <span className="chip success">
      <Icon name="check" />
      Confirmed
    </span>
  ) : (
    <span className="chip subtle">Unconfirmed</span>
  );
}

export function SaveButton({ personId, name, saved, withText = false }: { personId: string; name: string; saved: boolean; withText?: boolean }) {
  return (
    <form action={toggleSaved}>
      <input type="hidden" name="personId" value={personId} />
      <input type="hidden" name="saved" value={String(saved)} />
      <button
        type="submit"
        className={withText ? "btn" : "icon-button"}
        aria-pressed={saved}
        aria-label={withText ? undefined : `${saved ? "Unsave" : "Save"} ${name}`}
      >
        <Icon name={saved ? "check" : "save"} />
        {withText && (saved ? " Saved" : " Save contact")}
      </button>
    </form>
  );
}

export function educationLabel(degree: string | null, gradYear: number | null) {
  if (!degree && !gradYear) return null;
  return [degree, gradYear ? `’${String(gradYear).slice(-2)}` : null].filter(Boolean).join(" ");
}

/** The LinkedIn link wsbcconnect showed beside each name. */
export function LinkedInLink({ name, url, withText }: { name: string; url: string; withText?: boolean }) {
  return (
    <a
      className={withText ? "btn" : "linkedin-link"}
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={withText ? undefined : `${name} on LinkedIn (opens in a new tab)`}
    >
      <Icon name="linkedin" />
      {withText && <span>Connect on LinkedIn</span>}
    </a>
  );
}

export function PersonRow({
  person,
  saved,
  cue,
  linkedin,
  action,
}: {
  person: PersonSummary;
  saved: boolean;
  cue?: string | null;
  linkedin?: string | null;
  action?: { label: string; href: string } | null;
}) {
  const confirmed = isConfirmed(person.status);
  const market = person.metro ?? (person.city ? [person.city, person.state].filter(Boolean).join(", ") : null);
  const education = educationLabel(person.degree, person.grad_year);
  return (
    <article className="person">
      <Avatar name={person.full_name} photoUrl={person.photo_url} confirmed={confirmed} />
      <div>
        <div className="person-name">
          <Link href={`/people/${person.id}`}>{person.full_name}</Link>
          {linkedin && <LinkedInLink name={person.full_name} url={linkedin} />}
          <StatusBadge status={person.status} />
        </div>
        <p className="person-sub">
          {person.current_title ?? "Role not provided"} · {person.organization_name ?? "Employer not provided"}
        </p>
        <div className="person-meta">
          <span>
            <Icon name="pin" /> {market ?? "Location not provided"}
          </span>
          <span>{education ?? "Wisconsin degree not yet confirmed"}</span>
        </div>
        {cue && (
          <div className="person-why">
            <Icon name="intro" />
            <span>{cue}</span>
          </div>
        )}
        <div className="person-tags">
          {(person.open_to ?? []).slice(0, 2).map((tag) => (
            <span key={tag} className="chip">
              {OPEN_TO_LABELS[tag] ?? tag}
            </span>
          ))}
          {!confirmed && <span className="meta">Profile not yet claimed · Public / licensed sources</span>}
        </div>
      </div>
      <div className="person-actions">
        {action && (
          <Link className="btn primary" href={action.href}>
            {action.label}
          </Link>
        )}
        <SaveButton personId={person.id} name={person.full_name} saved={saved} />
        <Link className="btn" href={`/people/${person.id}`}>
          View profile
        </Link>
      </div>
    </article>
  );
}

export function EmptyState({ title, text, action }: { title: string; text: string; action?: React.ReactNode }) {
  return (
    <div className="empty">
      <Icon name="search" />
      <h2>{title}</h2>
      <p>{text}</p>
      {action}
    </div>
  );
}

export function PageTitle({ eyebrow, title, description, action }: { eyebrow: string; title?: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="page-title">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        {title && <h1>{title}</h1>}
        {description && <p>{description}</p>}
      </div>
      {action}
    </div>
  );
}

export { OPEN_TO_LABELS };

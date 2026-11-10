// Human labels for where profile data came from (field_provenance).

export const SOURCE_LABELS: Record<string, string> = {
  self: "Member-provided",
  roster: "Alumni roster",
  institution: "Wisconsin School of Business profile page",
  web: "Public web",
  pdl: "Licensed professional data",
  apollo: "Licensed professional data",
  clay: "Licensed professional data",
  hunter: "Licensed email data",
  registry: "Professional registry",
  linkedin: "LinkedIn",
  people_search: "People-search site",
  ai: "AI-generated from your profile",
  admin: "Administrator",
};

export const FIELD_LABELS: Record<string, string> = {
  full_name: "Name",
  current_title: "Current role",
  current_organization_id: "Employer",
  bio: "Biography",
  photo_url: "Photo",
  educations: "UW–Madison education",
  alumni_status: "Alumni status",
  location: "Location",
  industry_id: "Industry",
  linkedin: "LinkedIn link",
  positions: "Work history",
  ai_summary: "Summary",
  open_to: "Open to",
  contact_points: "Contact details",
};

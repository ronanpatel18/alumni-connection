// Human labels for where profile data came from (field_provenance).

export const SOURCE_LABELS: Record<string, string> = {
  self: "Member-provided",
  roster: "Alumni roster",
  institution: "Wisconsin School of Business profile page",
  web: "Public web",
  pdl: "Licensed professional data",
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

export const VISIBILITY_LABELS: Record<string, string> = {
  members: "All verified members",
  connections: "Connections only",
  private: "Hidden from everyone",
};

export const VISIBILITY_HELP: Record<string, string> = {
  members: "Any verified UW–Madison alum can see this.",
  connections: "Only people whose connection you’ve accepted can see this.",
  private: "No one else can see this. Administrators can, for identity checks.",
};

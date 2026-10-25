import { redirect } from "next/navigation";

// /portal/projects/<id> has no page of its own: it opens the first step of the wizard.
export default async function ProjectIndexPage({ params }: PageProps<"/portal/projects/[id]">) {
  const { id } = await params;
  redirect(`/portal/projects/${id}/basics`);
}

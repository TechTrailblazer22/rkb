import { ProfileForm } from "@/components/portal/profile-form";
import { requireBuilderContext } from "@/lib/builders/context";
import { profileToFormValues } from "@/lib/builders/profile";
import { getStorage } from "@/lib/storage";

export const metadata = { title: "Company profile" };

function publicUrl(key: string | null): string | null {
  if (!key) return null;
  try {
    return getStorage().publicUrl(key);
  } catch {
    return null; // storage not configured: show the placeholder instead of failing the page
  }
}

export default async function ProfilePage() {
  const { builder, mode } = await requireBuilderContext("/portal/profile", { ownerOnly: true });

  return (
    <ProfileForm
      initial={profileToFormValues(builder)}
      mode={mode}
      logoUrl={publicUrl(builder.logoKey)}
      coverUrl={publicUrl(builder.coverKey)}
    />
  );
}

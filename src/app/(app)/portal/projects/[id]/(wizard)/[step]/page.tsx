import { notFound } from "next/navigation";
import { Flash } from "@/components/project/flash";
import { StepForm } from "@/components/project/step-form";
import { ApprovalsSection } from "@/components/project/steps/approvals-section";
import { MediaSection } from "@/components/project/steps/media-section";
import { PlotsStep } from "@/components/project/steps/plots-step";
import { ReviewStep } from "@/components/project/steps/review-step";
import { isStepSlug, projectToFormValues, STEPS, type FormStep } from "@/lib/projects/fields";
import { requireProjectContext } from "@/lib/projects/context";

export async function generateMetadata({ params }: PageProps<"/portal/projects/[id]/[step]">) {
  const { step } = await params;
  return { title: STEPS.find((s) => s.slug === step)?.label ?? "Project" };
}

export default async function ProjectStepPage({
  params,
  searchParams,
}: PageProps<"/portal/projects/[id]/[step]">) {
  const { id, step } = await params;
  if (!isStepSlug(step)) notFound();
  const ctx = await requireProjectContext(id, `/portal/projects/${id}/${step}`);
  const query = await searchParams;
  const flash = <Flash saved={query.saved} error={query.error} />;

  if (step === "plots") {
    return (
      <div className="space-y-5">
        {flash}
        <PlotsStep ctx={ctx} query={query} />
      </div>
    );
  }
  if (step === "review") {
    return (
      <div className="space-y-5">
        {flash}
        <ReviewStep ctx={ctx} />
      </div>
    );
  }

  const formStep: FormStep = step;
  return (
    <div className="space-y-5">
      {flash}
      {/* key: moving to another step starts a fresh form, with its own autosave state */}
      <StepForm
        key={formStep}
        projectId={id}
        step={formStep}
        initial={projectToFormValues(ctx.project)}
        mode={ctx.projectMode}
      >
        {formStep === "approvals" && <ApprovalsSection projectId={id} mode={ctx.projectMode} />}
        {formStep === "media" && (
          <MediaSection projectId={id} mode={ctx.projectMode} entitlements={ctx.entitlements} />
        )}
      </StepForm>
    </div>
  );
}

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { TEMPLATES } from "@videoforge/templates";
import { validateProject, type Project } from "@videoforge/project-schema";

// NewProjectModal — template gallery + apply flow (Templates_Spec AC-2/AC-3/AC-4).
// Exercises the real component against a mocked projectStore.createProject + navigate.

const created: { input: { document?: Project; title: string } | null } = { input: null };

vi.mock("../../lib/projectStore.js", () => ({
  createProject: vi.fn(async (input: { document?: Project; title: string }) => {
    created.input = input;
    // Echo back a project with the supplied (or a generated) id.
    return { id: input.document?.id ?? "generated-id", title: input.title } as Project;
  }),
}));

const navigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => navigate };
});

import NewProjectModal from "../NewProjectModal.js";
import { useTemplateStore } from "../../store/templateStore.js";

beforeEach(() => {
  created.input = null;
  navigate.mockReset();
  useTemplateStore.setState({ manifestByProjectId: {} });
});
afterEach(() => vi.clearAllMocks());

function renderModal() {
  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <NewProjectModal />
    </MemoryRouter>,
  );
}

describe("template gallery", () => {
  it("renders all 5 template cards (AC-2)", () => {
    renderModal();
    for (const t of TEMPLATES) {
      expect(screen.getByTestId(`template-card-${t.manifest.id}`)).toBeInTheDocument();
    }
  });

  it("picking a template swaps the CTA label to 'Use template →'", async () => {
    const user = userEvent.setup();
    renderModal();
    expect(screen.getByRole("button", { name: /Create project/i })).toBeInTheDocument();
    await user.click(screen.getByTestId(`template-card-${TEMPLATES[0]!.manifest.id}`));
    expect(screen.getByRole("button", { name: /Use template →/i })).toBeInTheDocument();
  });
});

describe("apply flow", () => {
  it("clones the template into a fresh valid Project, sets templateId, stashes the manifest, and navigates (AC-3/AC-4)", async () => {
    const user = userEvent.setup();
    renderModal();

    const template = TEMPLATES[0]!;
    await user.click(screen.getByTestId(`template-card-${template.manifest.id}`));
    await user.click(screen.getByRole("button", { name: /Use template →/i }));

    await waitFor(() => expect(created.input).not.toBeNull());

    const doc = created.input!.document!;
    expect(doc, "a cloned document is supplied to createProject").toBeDefined();
    expect(validateProject(doc).ok).toBe(true);
    // Provenance set; fresh id (not the template's own document id).
    expect(doc.templateId).toBe(template.manifest.id);
    expect(doc.id).not.toBe(template.document.id);
    // Rewritten manifest stashed for the editor's slot panel + export prune.
    expect(useTemplateStore.getState().manifestByProjectId[doc.id]).toBeDefined();
    // Opened in the editor.
    await waitFor(() => expect(navigate).toHaveBeenCalledWith(`/editor/${doc.id}`));
  });

  it("the blank path still works (no template selected → no document supplied)", async () => {
    const user = userEvent.setup();
    renderModal();
    // Select the 9:16 ratio tile directly (no template).
    await user.click(screen.getByRole("radio", { name: /9:16/i }));
    await user.click(screen.getByRole("button", { name: /Create project/i }));
    await waitFor(() => expect(created.input).not.toBeNull());
    expect(created.input!.document).toBeUndefined();
  });
});

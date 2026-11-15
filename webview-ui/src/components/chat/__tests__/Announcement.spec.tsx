import React from "react"

import { fireEvent, render, screen } from "@/utils/test-utils"
import { vscode } from "@src/utils/vscode"

import Announcement, { REPOSITORY_URL } from "../Announcement"

vi.mock("@src/utils/vscode", () => ({
	vscode: {
		postMessage: vi.fn(),
	},
}))

vi.mock("@bear/package", () => ({
	Package: {
		version: "0.2.0",
	},
}))

vi.mock("@vscode/webview-ui-toolkit/react", () => ({
	VSCodeLink: ({ children, href, onClick, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
		<a href={href} onClick={onClick} {...props}>
			{children}
		</a>
	),
}))

vi.mock("react-i18next", () => ({
	Trans: ({ i18nKey, components }: { i18nKey: string; components?: Record<string, React.ReactElement> }) => {
		if (i18nKey === "chat:announcement.support") {
			return (
				<span>
					Please support BearCode by starring us on{" "}
					{components?.githubLink && React.cloneElement(components.githubLink, {}, "GitHub")}.
				</span>
			)
		}

		return <span>{i18nKey}</span>
	},
}))

vi.mock("@src/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({
		t: (key: string, options?: { version?: string }) =>
			key === "chat:announcement.title" ? `BearCode ${options?.version} Released` : key,
	}),
}))

describe("Announcement", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("renders the release title with the extension version", () => {
		render(<Announcement hideAnnouncement={vi.fn()} />)

		expect(screen.getByText("BearCode 0.2.0 Released")).toBeInTheDocument()
		expect(screen.getByText(/Please support BearCode by starring us on/)).toBeInTheDocument()
	})

	it("links to the BearCode repository and opens it externally", () => {
		render(<Announcement hideAnnouncement={vi.fn()} />)

		const link = screen.getByRole("link", { name: "GitHub" })
		expect(link).toHaveAttribute("href", REPOSITORY_URL)

		fireEvent.click(link)
		expect(vscode.postMessage).toHaveBeenCalledWith({ type: "openExternal", url: REPOSITORY_URL })
	})

	it("calls hideAnnouncement when the dialog is closed", () => {
		const hideAnnouncement = vi.fn()
		render(<Announcement hideAnnouncement={hideAnnouncement} />)

		fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" })

		expect(hideAnnouncement).toHaveBeenCalled()
	})
})

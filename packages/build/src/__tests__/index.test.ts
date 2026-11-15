// npx vitest run src/__tests__/index.test.ts

import { generatePackageJson } from "../index.js"

describe("generatePackageJson", () => {
	it("should be a test", () => {
		const generatedPackageJson = generatePackageJson({
			packageJson: {
				name: "bear-code",
				displayName: "%extension.displayName%",
				description: "%extension.description%",
				publisher: "bearcode",
				version: "3.17.2",
				icon: "assets/icons/icon.png",
				contributes: {
					viewsContainers: {
						activitybar: [
							{
								id: "bear-code-ActivityBar",
								title: "%views.activitybar.title%",
								icon: "assets/icons/icon.svg",
							},
						],
					},
					views: {
						"bear-code-ActivityBar": [
							{
								type: "webview",
								id: "bear-code.SidebarProvider",
								name: "",
							},
						],
					},
					commands: [
						{
							command: "bear-code.plusButtonClicked",
							title: "%command.newTask.title%",
							icon: "$(edit)",
						},
						{
							command: "bear-code.openInNewTab",
							title: "%command.openInNewTab.title%",
							category: "%configuration.title%",
						},
					],
					menus: {
						"editor/context": [
							{
								submenu: "bear-code.contextMenu",
								group: "navigation",
							},
						],
						"bear-code.contextMenu": [
							{
								command: "bear-code.addToContext",
								group: "1_actions@1",
							},
						],
						"editor/title": [
							{
								command: "bear-code.plusButtonClicked",
								group: "navigation@1",
								when: "activeWebviewPanelId == bear-code.TabPanelProvider",
							},
							{
								command: "bear-code.settingsButtonClicked",
								group: "navigation@6",
								when: "activeWebviewPanelId == bear-code.TabPanelProvider",
							},
							{
								command: "bear-code.accountButtonClicked",
								group: "navigation@6",
								when: "activeWebviewPanelId == bear-code.TabPanelProvider",
							},
						],
					},
					submenus: [
						{
							id: "bear-code.contextMenu",
							label: "%views.contextMenu.label%",
						},
						{
							id: "bear-code.terminalMenu",
							label: "%views.terminalMenu.label%",
						},
					],
					configuration: {
						title: "%configuration.title%",
						properties: {
							"bear-code.allowedCommands": {
								type: "array",
								items: {
									type: "string",
								},
								default: ["npm test", "npm install", "tsc", "git log", "git diff", "git show"],
								description: "%commands.allowedCommands.description%",
							},
							"bear-code.customStoragePath": {
								type: "string",
								default: "",
								description: "%settings.customStoragePath.description%",
							},
						},
					},
				},
				scripts: {
					lint: "eslint **/*.ts",
				},
			},
			overrideJson: {
				name: "bear-code-nightly",
				displayName: "BearCode Nightly",
				publisher: "bearcode",
				version: "0.0.1",
				icon: "assets/icons/icon-nightly.png",
				scripts: {},
			},
			substitution: ["bear-code", "bear-code-nightly"],
		})

		expect(generatedPackageJson).toStrictEqual({
			name: "bear-code-nightly",
			displayName: "BearCode Nightly",
			description: "%extension.description%",
			publisher: "bearcode",
			version: "0.0.1",
			icon: "assets/icons/icon-nightly.png",
			contributes: {
				viewsContainers: {
					activitybar: [
						{
							id: "bear-code-nightly-ActivityBar",
							title: "%views.activitybar.title%",
							icon: "assets/icons/icon.svg",
						},
					],
				},
				views: {
					"bear-code-nightly-ActivityBar": [
						{
							type: "webview",
							id: "bear-code-nightly.SidebarProvider",
							name: "",
						},
					],
				},
				commands: [
					{
						command: "bear-code-nightly.plusButtonClicked",
						title: "%command.newTask.title%",
						icon: "$(edit)",
					},
					{
						command: "bear-code-nightly.openInNewTab",
						title: "%command.openInNewTab.title%",
						category: "%configuration.title%",
					},
				],
				menus: {
					"editor/context": [
						{
							submenu: "bear-code-nightly.contextMenu",
							group: "navigation",
						},
					],
					"bear-code-nightly.contextMenu": [
						{
							command: "bear-code-nightly.addToContext",
							group: "1_actions@1",
						},
					],
					"editor/title": [
						{
							command: "bear-code-nightly.plusButtonClicked",
							group: "navigation@1",
							when: "activeWebviewPanelId == bear-code-nightly.TabPanelProvider",
						},
						{
							command: "bear-code-nightly.settingsButtonClicked",
							group: "navigation@6",
							when: "activeWebviewPanelId == bear-code-nightly.TabPanelProvider",
						},
						{
							command: "bear-code-nightly.accountButtonClicked",
							group: "navigation@6",
							when: "activeWebviewPanelId == bear-code-nightly.TabPanelProvider",
						},
					],
				},
				submenus: [
					{
						id: "bear-code-nightly.contextMenu",
						label: "%views.contextMenu.label%",
					},
					{
						id: "bear-code-nightly.terminalMenu",
						label: "%views.terminalMenu.label%",
					},
				],
				configuration: {
					title: "%configuration.title%",
					properties: {
						"bear-code-nightly.allowedCommands": {
							type: "array",
							items: {
								type: "string",
							},
							default: ["npm test", "npm install", "tsc", "git log", "git diff", "git show"],
							description: "%commands.allowedCommands.description%",
						},
						"bear-code-nightly.customStoragePath": {
							type: "string",
							default: "",
							description: "%settings.customStoragePath.description%",
						},
					},
				},
			},
			scripts: {},
		})
	})
})

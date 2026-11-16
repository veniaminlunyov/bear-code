import os from "os"

// Mock the modules - must be hoisted before imports
vi.mock("os-name", () => ({
	default: vi.fn(),
}))

vi.mock("../../../../utils/shell", () => ({
	getShell: vi.fn(() => "/bin/bash"),
}))

import { getSystemInfoSection } from "../system-info"
import osName from "os-name"

const mockOsName = vi.mocked(osName)

describe("getSystemInfoSection", () => {
	const mockCwd = "/test/workspace"
	const mockHomeDir = "/home/user"

	beforeEach(() => {
		vi.spyOn(os, "homedir").mockReturnValue(mockHomeDir)
		vi.spyOn(os, "platform").mockReturnValue("linux")
		vi.spyOn(os, "release").mockReturnValue("5.15.0")
	})

	afterEach(() => {
		vi.clearAllMocks()
		vi.restoreAllMocks()
	})

	it("should return system info with os-name when available", () => {
		mockOsName.mockReturnValue("Ubuntu 22.04")

		const result = getSystemInfoSection(mockCwd)

		expect(result).toContain("Operating System: Ubuntu 22.04")
		expect(result).toContain("Default Shell: /bin/bash")
		expect(result).toContain(`Home Directory: ${mockHomeDir}`)
		expect(result).toContain(`Current Workspace Directory: ${mockCwd}`)
	})

	it.each([
		{
			platform: "linux" as const,
			release: "5.15.0",
			makeLookupThrow: () =>
				mockOsName.mockImplementation(() => {
					throw new Error("Command failed with ENOENT: powershell")
				}),
		},
		{
			platform: "win32" as const,
			release: "10.0.26300",
			makeLookupThrow: () =>
				vi.spyOn(os, "version").mockImplementation(() => {
					throw new Error("uv_os_uname failed")
				}),
		},
	])(
		"falls back to platform and release when the OS lookup throws on $platform",
		({ platform, release, makeLookupThrow }) => {
			vi.spyOn(os, "platform").mockReturnValue(platform)
			vi.spyOn(os, "release").mockReturnValue(release)
			makeLookupThrow()

			const result = getSystemInfoSection(mockCwd)

			expect(result).toContain(`Operating System: ${platform} ${release}`)
			expect(result).toContain("Default Shell: /bin/bash")
			expect(result).toContain(`Home Directory: ${mockHomeDir}`)
			expect(result).toContain(`Current Workspace Directory: ${mockCwd}`)
		},
	)

	describe("on Windows", () => {
		beforeEach(() => {
			vi.spyOn(os, "platform").mockReturnValue("win32")
			vi.spyOn(os, "release").mockReturnValue("10.0.26300")
		})

		it("reads the product name from os.version() without calling os-name", () => {
			// os-name runs wmic and PowerShell synchronously on Windows; a PowerShell that never
			// exits freezes the extension host, so it must not be reached at all.
			vi.spyOn(os, "version").mockReturnValue("Windows 11 Pro")

			const result = getSystemInfoSection(mockCwd)

			expect(result).toContain("Operating System: Windows 11 Pro")
			expect(mockOsName).not.toHaveBeenCalled()
		})

		it("falls back to platform and release when os.version() is empty", () => {
			vi.spyOn(os, "version").mockReturnValue("")

			const result = getSystemInfoSection(mockCwd)

			expect(result).toContain("Operating System: win32 10.0.26300")
			expect(mockOsName).not.toHaveBeenCalled()
		})
	})
})

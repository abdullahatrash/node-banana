const physicalDirectionalUtility = /(?:^|:)(?:(?:m[lr]|p[lr]|scroll-m[lr])-[A-Za-z0-9_[\]./()-]+|border-[lr](?:-[A-Za-z0-9_[\]./()-]+)?|rounded-[lr](?:-[A-Za-z0-9_[\]./()-]+)?|text-(?:left|right))$/u;

/**
 * Finds physical Tailwind spacing, border, and text-alignment utilities that should normally be
 * logical in bilingual product surfaces.
 *
 * A drawer with an explicit left/right direction is a physical-edge contract,
 * so those scoped variants remain valid regardless of document direction.
 */
export function findPhysicalDirectionalUtilities(source) {
  return [...new Set(
    source
      .split(/[\s"'`]+/u)
      .map((token) => token.replace(/[),;]+$/u, ""))
      .filter((token) => physicalDirectionalUtility.test(token))
      .filter((token) => !token.includes("data-[vaul-drawer-direction=")),
  )];
}

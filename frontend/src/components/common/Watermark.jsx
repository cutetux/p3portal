// p3portal.org
/**
 * Dezenter Page-Footer-Watermark mit Link auf das Projekt.
 * Wird am Ende des scrollbaren Hauptbereichs jeder Seite gerendert.
 */
export default function Watermark() {
  return (
    <a
      href="http://p3portal.org"
      target="_blank"
      rel="noopener noreferrer"
      className="block text-center text-[9px] text-portal-text3/40 tracking-wider pt-6 pb-2 hover:text-portal-text3/70 hover:underline transition-colors"
    >
      p3portal.org
    </a>
  )
}

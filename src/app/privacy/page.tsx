export const metadata = {
  title: 'Política de privacidad',
  robots: { index: false, follow: false },
};

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-16 text-foreground">
      <h1 className="text-2xl font-bold">Política de privacidad — GMVA Auto</h1>
      <p className="mt-2 text-sm text-muted-foreground">Última actualización: 2026</p>

      <div className="mt-8 space-y-6 text-sm leading-relaxed">
        <section>
          <h2 className="text-base font-semibold text-foreground">Qué datos recopilamos</h2>
          <p className="mt-2">
            Cuando nos escribes por WhatsApp o interactúas con uno de nuestros anuncios en
            Facebook/Instagram, guardamos tu nombre, número de teléfono y el contenido de la
            conversación, para poder responderte y darte seguimiento como cliente o interesado.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground">Cómo usamos tus datos</h2>
          <p className="mt-2">
            Usamos esta información únicamente para atenderte (responder consultas, coordinar
            ventas y envíos) y, si corresponde, para contactarte con ofertas relacionadas a
            productos que ya mostraste interés. No vendemos ni compartimos tus datos con terceros
            ajenos a la operación de nuestro negocio.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground">Anuncios en Meta (Facebook/Instagram)</h2>
          <p className="mt-2">
            Cuando haces clic en uno de nuestros anuncios para escribirnos por WhatsApp, Meta nos
            entrega datos agregados sobre el rendimiento del anuncio (clics, alcance) de acuerdo a
            sus propias políticas de privacidad. No accedemos a tu información personal de
            Facebook o Instagram fuera de lo que vos mismo nos compartís al escribirnos.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground">Tus derechos</h2>
          <p className="mt-2">
            Podés pedirnos en cualquier momento que eliminemos tu conversación e información de
            contacto de nuestros registros, escribiéndonos por el mismo WhatsApp o al correo de
            contacto debajo.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-foreground">Contacto</h2>
          <p className="mt-2">gmvglobalimports@gmail.com</p>
        </section>
      </div>
    </div>
  );
}

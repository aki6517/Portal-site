import ContactForm from "./ContactForm";

export default function ContactPage() {
  const siteKey = process.env.RECAPTCHA_SITE_KEY ?? "";

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-2xl font-bold">お問い合わせ</h1>
      <p className="mt-2 text-sm text-zinc-600">
        お問い合わせ内容を送信してください。通常2-3営業日以内に返信します。
      </p>
      <div className="mt-6">
        <ContactForm siteKey={siteKey} />
      </div>
    </div>
  );
}

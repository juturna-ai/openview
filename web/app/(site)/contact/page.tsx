import type { Metadata } from 'next';
import ContactForm from './ContactForm';

export const metadata: Metadata = { title: 'Contact — Openview' };

export default function ContactPage() {
  return (
    <div className="ov-container ov-prose">
      <h2 className="ov-h2">Contact</h2>
      <p>Questions, bug reports, or feedback about the Openview chart engine? Send a note below.</p>
      <ContactForm />
    </div>
  );
}

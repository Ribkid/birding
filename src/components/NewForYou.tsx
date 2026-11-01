import './newForYou.css';

/** The gold "new for you" mark, shared so it cannot drift into red or orange anywhere in the app. */
export default function NewForYou({ label = 'New for you' }: { label?: string }) {
  return <span className="new-for-you">{label}</span>;
}

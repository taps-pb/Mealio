import LibraryShell from "@/components/library/LibraryShell";
import styles from "@/components/library/Library.module.css";

export default function Page() {
  return <LibraryShell title="About Mealio" subtitle="Your meals. Your device. Your journal.">
    <div className={styles.sources}><p>Food estimates and your custom library work locally. Login, saving meals and meal history use your online journal.</p>
      <a className={styles.linkRow} href="/about/sources">Data sources &amp; licenses <span aria-hidden="true">›</span></a>
      <a className={styles.linkRow} href="/nutrition">Offline food estimator <span aria-hidden="true">›</span></a>
      <a className={styles.linkRow} href="/foods/settings">Library management <span aria-hidden="true">›</span></a>
    </div>
  </LibraryShell>;
}

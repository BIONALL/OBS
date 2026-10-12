# Panduan Migrasi Portal Siswa BION ke GitHub Pages

Portal sekarang terbagi menjadi dua bagian:

| Bagian | Tempat | Isi |
|---|---|---|
| **Backend (API)** | Google Apps Script (proyek yang sama seperti sekarang) | `Kode.gs`, hanya mengirim data JSON |
| **Frontend (tampilan)** | GitHub Pages | `index.html`, `css/`, `js/` |

Data di Google Sheets, lampiran di Drive, dan akun staf **tidak berubah**. Yang berubah hanya cara tampilan dimuat.

---

## Yang berbeda dari versi lama

- **Alamat portal baru:** `https://USERNAME.github.io/portal-siswa-bion/`
- **Panel staf:** buka alamat yang sama, ditambah `#staf` di akhir (contoh: `https://USERNAME.github.io/portal-siswa-bion/#staf`). Tidak perlu deployment terpisah lagi.
- **Login otomatis lewat akun Google dihapus.** Semua staf masuk dengan **email + kata sandi**. Pastikan setiap staf sudah punya kata sandi di menu **Kelola Staf** sebelum beralih.
- **Beban server lebih ringan:** tampilan dimuat dari GitHub, Apps Script hanya melayani data.

---

## TAHAP A — Backend di Apps Script

> Lakukan di **proyek Apps Script yang sudah ada**, supaya database dan pengaturan tetap terhubung.

1. Buka proyek Apps Script Portal BION.
2. Buka file **Kode**, hapus seluruh isinya, lalu tempel isi `Kode.gs` yang baru. Klik **Simpan**.
3. Hapus file **Index**, **Stylesheet**, dan **JavaScript** dari proyek (ikon titik tiga di samping nama file → *Delete*). File ini sudah pindah ke GitHub.
4. **Kata sandi Admin Utama.** Jika selama ini Anda masuk lewat akun Google (tanpa kata sandi):
   - Pilih fungsi **`resetSandiAdmin`** di dropdown → klik **▶ Run**.
   - Buka **Execution log**. Di sana tertulis kata sandi sementara, misalnya `🔑 Kata sandi sementara untuk admin@… : a1b2c3d4e5f6`.
   - Catat sandi itu. Setelah portal baru jalan, ganti di tab **Akun Saya**.
5. **Buat deployment BARU** (jangan mengedit deployment lama):
   - **Deploy → New deployment** → ikon gerigi → **Web app**
   - **Execute as:** `Me`
   - **Who has access:** `Anyone`
   - Klik **Deploy**, lalu **salin Web app URL** (berakhiran `/exec`).
6. **Uji API:** buka di browser `URL_EXEC?action=ping`. Hasil yang benar berupa teks seperti:
   `{"success":true,"data":{...},"message":"API Portal BION aktif."}`

> 💡 **Kenapa deployment baru?** Deployment lama terkunci pada versi kode lama, jadi portal lama tetap jalan selama Anda menyiapkan GitHub Pages. Setelah portal baru berjalan, deployment lama bisa diarsipkan lewat **Manage deployments → Archive**.

> ⚠️ **Jika pilihan "Anyone" tidak muncul**, akun Google Workspace Anda membatasi akses publik. Minta admin Google Workspace mengizinkan web app untuk "Anyone", atau buat proyek di akun Gmail pribadi yang memiliki akses ke spreadsheet. Tanpa "Anyone", portal akan menampilkan pesan *"Server API menolak akses"*.

---

## TAHAP B — Isi alamat API di frontend

1. Ekstrak ZIP. Hasilnya folder **`portal-siswa-bion`** berisi `index.html`, `css/`, `js/`, dan file panduan.
2. Buka `js/config.js` dengan Notepad.
3. Ganti `https://script.google.com/macros/s/GANTI_DENGAN_ID_DEPLOYMENT/exec` dengan URL `/exec` dari Tahap A langkah 5.
4. Simpan.

---

## TAHAP C — Unggah ke GitHub Pages

> Folder yang di-`git init` adalah **`portal-siswa-bion`**, yaitu folder yang langsung berisi `index.html`. Jangan menjalankannya di folder di atasnya.

### C1. Siapkan (sekali saja)
1. Install Git dari https://git-scm.com/download/win (pengaturan bawaan). Cek dengan `git --version`.
2. Buat akun di https://github.com jika belum punya.
3. Atur identitas:
   ```bash
   git config --global user.name "Nama Anda"
   git config --global user.email "email-akun-github@contoh.com"
   ```

### C2. Buat repository
Di GitHub: **+ → New repository** → nama `portal-siswa-bion` → pilih **Public** → **jangan** centang README/.gitignore/license → **Create repository**.

### C3. Masuk ke folder & periksa isinya
Buka folder `portal-siswa-bion` di File Explorer, klik address bar, ketik `powershell`, tekan Enter. Lalu:
```powershell
dir
```
Yang harus terlihat: `index.html`, folder `css`, folder `js`. Jika yang terlihat justru folder `portal-siswa-bion` lagi, masuk dulu dengan `cd portal-siswa-bion`.

### C4. Kirim ke GitHub (jalankan satu per satu)
```bash
git init
git add .
git commit -m "Upload pertama Portal Siswa BION"
git branch -M main
git remote add origin https://github.com/USERNAME/portal-siswa-bion.git
git push -u origin main
```
- Perhatikan titik di akhir `git add .`
- Saat diminta **Password**, tempel **Personal Access Token**, bukan sandi akun GitHub. Buat di https://github.com/settings/tokens → *Generate new token (classic)* → centang **repo** → salin token `ghp_…`.
- Saat menempel token, layar terlihat kosong. Itu normal; tekan Enter.
- Berhasil bila muncul `* [new branch] main -> main`.

### C5. Aktifkan Pages
Di repository: **Settings → Pages** → Source **Deploy from a branch** → Branch **main** / **(root)** → **Save**. Centang **Enforce HTTPS**. Setelah 1–2 menit muncul:
`Your site is live at https://USERNAME.github.io/portal-siswa-bion/`

---

## TAHAP D — Uji portal baru

1. Buka alamat portal. Beranda, jenjang, dan pengumuman harus tampil.
2. Buka salah satu layanan (misalnya **SMP → Join Kelas**) dan pastikan halamannya terbuka.
3. Buka `…/portal-siswa-bion/#staf`, masuk dengan email + kata sandi.
4. Ubah satu link di tab **Link Menu**, klik **Segarkan portal**, lalu cek di beranda.
5. Jika ada masalah, tekan **F12 → Console** dan kirim screenshot pesannya.

Setelah semua berjalan:
- Ganti tautan portal di Blogger, grup WhatsApp, dan bio media sosial ke alamat GitHub Pages.
- Isi **Pengaturan → Alamat portal** di panel staf sebagai catatan.
- Arsipkan deployment Apps Script yang lama.

---

## Memperbarui tampilan di kemudian hari

Dari folder `portal-siswa-bion`:
```bash
git add .
git commit -m "Keterangan perubahan"
git push
```
GitHub Pages memperbarui situs dalam 1–2 menit. Jika masih tampil versi lama, tekan **Ctrl+Shift+R**.

Jika yang berubah adalah `Kode.gs`: tempel kode baru di Apps Script, lalu **Deploy → Manage deployments → Edit (ikon pensil) → Version: New version → Deploy**. URL `/exec` tetap sama, jadi `config.js` tidak perlu diubah.

---

## Masalah umum

| Yang terlihat | Penyebab | Solusi |
|---|---|---|
| "Alamat API belum diatur" | `js/config.js` belum diisi | Isi `GAS_URL`, lalu `git add .` → `git commit` → `git push` |
| "Server API menolak akses" | Deployment bukan "Anyone" | Buat deployment baru dengan **Who has access: Anyone** |
| Data belum berubah setelah sheet diedit langsung | Cache server 5 menit | Klik **Segarkan portal** di panel staf, atau tunggu 5 menit |
| Halaman 404 di GitHub Pages | `git init` dijalankan di folder yang salah | Di GitHub, `index.html` harus terlihat langsung di halaman repository |
| Tampilan tanpa warna/tata letak | Folder `css/` atau `js/` tidak ikut | Selalu unggah lewat terminal, bukan "Upload files" di web |
| "Password authentication is not supported" | GitHub menolak sandi biasa | Gunakan Personal Access Token |
| Staf tidak bisa masuk | Belum punya kata sandi | Admin Utama mengatur sandi di **Kelola Staf**, atau jalankan `resetSandiAdmin` untuk akun admin |
| "Terlalu banyak percobaan" | 5 kali salah sandi | Tunggu 10 menit |

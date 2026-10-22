# Installing Mediescare

For anyone setting up Mediescare on a pharmacy computer. No technical knowledge needed.

## 1. Download

1. Open **https://github.com/ThemedEdits/mediescare-new/releases/latest**.
2. Under **Assets**, click **Mediescare-Setup-<version>.exe** to download it.

## 2. Install

1. Double-click the downloaded file.
2. If Windows shows **"Windows protected your PC"**, click **More info**, then **Run anyway**. (The installer is not
   signed with a paid company certificate yet; this is expected.)
3. Choose who it is for:
   - **The main computer of a branch (or Head Office):** choose **Anyone who uses this computer (all users)**. Windows
     asks for permission; click **Yes**. This also opens the Windows Firewall so the other computers of the branch can
     connect to it.
   - **Any other computer:** either choice is fine.
4. Keep the suggested folder and click **Install**, then **Finish**. Mediescare starts. A desktop icon is added.

The computer needs the internet for the first setup of a branch's main computer and for sharing data with Head
Office. Selling and everything else work without the internet.

## 3. First start: which button to press

| This computer is... | Choose | You need |
|---|---|---|
| The very first Head Office computer (done once, ever) | **Create a new Head Office** | Organisation name and code, your owner account. Write down the **recovery key** shown at the end. |
| The main computer of a branch | **Sign in to an existing Head Office or branch** > **The main computer of the branch** | Organisation code, a **join code** from Head Office (Computers > New join code), the branch manager's username and password |
| A second (or third) computer in a branch | **Sign in to an existing Head Office or branch** > **An extra computer in the branch** | Both computers on the same Wi-Fi or network; the **pairing code** from the main computer (Sync > Add a computer) and a manager's login |
| A new Head Office computer because the old one is lost | **Sign in to an existing Head Office or branch** > **The main computer of the branch**, then tick **This is a new Head Office computer** | Organisation code, the **recovery key**, the owner's login |

After that, staff only need their **username and password**.

## 4. Updates

When a new version is published, Mediescare downloads it in the background and shows **Update** in the top bar.

- A manager clicks it and presses **Restart and update**. A safety backup is made, Mediescare restarts on the new
  version, and the data stays as it is.
- Or simply close Mediescare at the end of the day. The update installs, and the next start is on the new version.

You can also see the version and check for updates on **Help and updates** (left menu, Administration).

## 5. Where the data is

- The data of this computer is in `%APPDATA%\Mediescare` (paste that into the File Explorer address bar to open it).
- Uninstalling Mediescare does **not** delete the data.
- Backups are made every day in the `backups` folder there. A second copy can go to a USB disk (Backups page).

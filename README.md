# TCF Simulation

Application Next.js App Router avec Supabase Auth et PostgreSQL.

## Installation

```bash
npm install
npm run dev
```

Copiez `.env.example` vers `.env.local` avant de lancer `npm run build`, puis renseignez :

- `NEXT_PUBLIC_SUPABASE_URL` : URL du projet Supabase.
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` : clé publique `sb_publishable_...` du projet. Ne pas la remplacer par une ancienne variable `ANON_KEY`.
- `SUPABASE_SERVICE_ROLE_KEY` : clé secrète réservée aux scripts et traitements serveur. Ne jamais la préfixer par `NEXT_PUBLIC_` ni l’utiliser dans le navigateur.

La page `/admin/utilisateurs` utilise cette dernière variable pour bannir/réactiver les comptes via Supabase Auth et révoquer leurs sessions. Récupérez la clé secrète du projet dans Supabase (Project Settings → API Keys), ajoutez-la dans `.env.local` sous `SUPABASE_SERVICE_ROLE_KEY=...`, puis redémarrez `npm run dev`. Ne partagez pas cette clé et ne la commitez jamais.

Sans URL et clé publique, les écrans du tableau de bord restent disponibles avec des états vides explicites ; aucun faux résultat n’est affiché. Le moteur d’examen exige toujours Supabase et ne charge jamais de questions de démonstration.

## Base de données et Auth

Dans le SQL Editor Supabase, exécutez dans l’ordre le contenu de `supabase/migrations/001_init.sql`, `supabase/migrations/002_admin_content.sql`, `supabase/migrations/003_admin_content_read_permissions.sql`, `supabase/migrations/004_public_exam_catalog_counts.sql`, `supabase/migrations/005_exam_section_order.sql`, `supabase/migrations/006_manual_payments_and_exam_access.sql`, `supabase/migrations/007_plan_presentation_fields.sql`, `supabase/migrations/008_one_pending_payment.sql`, `supabase/migrations/009_fix_admin_entitlement_email_type.sql`, `supabase/migrations/010_cancel_own_pending_payment.sql`, `supabase/migrations/011_allow_cancelled_payment_status.sql`, `supabase/migrations/012_exam_attempts.sql`, puis `supabase/migrations/013_count_usable_exam_questions.sql`. Les migrations 001 à 007 sont à appliquer une fois ; les migrations 008 à 013 peuvent être rejouées. La migration 010 est autonome pour l’annulation : elle ajoute aussi le statut, la politique RLS, les droits SQL et le déclencheur d’audit nécessaires. La migration 011 corrige la contrainte de statut si l’annulation échoue avec l’erreur PostgreSQL 23514. La migration 012 tire et conserve les questions de chaque tentative, sécurise la lecture/sauvegarde/soumission côté serveur, consomme un crédit au démarrage confirmé, calcule les scores avec `cefr_thresholds` et demande à PostgREST de recharger son cache de schéma. La migration 013 aligne les nombres du catalogue sur les questions réellement utilisables au démarrage (bonne réponse renseignée) et recharge le cache PostgREST. La première migration crée les tables, politiques RLS, vues publiques qui masquent les bonnes réponses, fonction `is_admin()` et profil par défaut pour chaque nouvel inscrit. La seconde crée le bucket audio privé et ses politiques d’accès réservées aux administrateurs, ainsi que la contrainte de quatre choix par question. La troisième accorde les privilèges de lecture requis par le panneau d’administration ; les politiques RLS continuent de limiter l’accès à ces contenus aux administrateurs. La quatrième expose uniquement le nombre de questions, le type et la durée des épreuves publiées pour le catalogue, sans rendre leur contenu accessible. La cinquième attribue une position fixe aux sections selon l’ordre CO, SL, CE, EE, EO, également utilisé à l’affichage. La sixième accorde les privilèges SQL nécessaires, ajoute les fonctions transactionnelles réservées aux admins, la vérification/consommation des accès au démarrage d’un examen et le démarrage anonyme des examens gratuits publiés. La septième ajoute les champs d’affichage des offres (`objective`, `badge`, `features`, `exam_type`) et les droits de modification correspondants, protégés par RLS admin. La huitième conserve une seule demande `pending` par compte et forfait, autorise l’annulation par le propriétaire et limite ses droits SQL à ce changement de statut. La neuvième corrige le type de l’adresse email renvoyée par `admin_list_entitlements()` afin que la fonction corresponde à son type de retour déclaré.

Si l’API indique `Could not find the function public.submit_exam(...) in the schema cache`, vérifiez que la migration 012 a été exécutée sur le même projet Supabase que celui configuré dans l’application. Si elle l’a déjà été, exécutez `NOTIFY pgrst, 'reload schema';` dans le SQL Editor puis réessayez.

Après les migrations 001 à 013, exécutez également `supabase/migrations/014_tiered_question_draws.sql`, puis `supabase/migrations/015_payment_audit_and_exam_entitlement_access.sql` et `supabase/migrations/016_dashboard_analytics_and_notifications.sql`. La migration 014 ajoute les niveaux de difficulté, les règles de tirage et les snapshots immuables des questions/points de chaque tentative. Elle crée les règles CE par défaut (3/5/8/9/5/4 questions avec 3/9/15/21/26/33 points), et des règles de niveau 1 pour CO (34) et SL (23). Dans le panneau admin, attribuez les niveaux par plages de positions ou modifiez le niveau d’une question individuellement ; la colonne `tier` est aussi facultative dans les imports CSV/JSON. Les comptes administrateurs peuvent modifier les règles de tirage par niveau, avec validation du nombre de questions disponibles et du total. Le démarrage refuse explicitement un niveau insuffisamment alimenté ; les scores des trois épreuves sont normalisés sur 699. La migration 015 corrige l’accès aux plans qui incluent explicitement un examen, évite le double débit d’un crédit lors du déclencheur de création de tentative, retire aux comptes authentifiés les écritures directes sur `entitlements`, et expose un journal des 100 dernières actions réservé aux admins via `admin_list_payment_audit()`. Elle remplace le démarrage d’examen et recharge le cache de schéma PostgREST.

> Le fichier `004_one_pending_payment.sql` demandé existe déjà sous un autre usage dans ce dépôt (`004_public_exam_catalog_counts.sql`). La nouvelle migration porte donc le numéro `008` pour éviter un doublon de version et préserver les migrations existantes.

## Moteur d’examen CO/SL/CE (phase 3)

Le parcours `/examen` utilise uniquement les questions publiées dans Supabase. Après application de la migration 014, les règles par épreuve déterminent les quantités et points de chaque niveau ; les questions déjà vues sont évitées tant que des alternatives existent. Une tentative conserve l’ordre et les points dans `attempts.question_ids` et `attempts.question_points`, de sorte qu’un rafraîchissement ou une modification ultérieure des règles ne change pas l’examen commencé. Les réponses sont enregistrées dans `answers`. Les bonnes réponses ne sont pas incluses dans les données servies au candidat ; `submit_exam` calcule les scores normalisés sur 699 et les niveaux depuis `cefr_thresholds`.

Pour vérifier la phase 3 après avoir appliqué les migrations 012 et 014 :

1. Dans l’admin, publiez un examen gratuit et un examen payant, chacun avec CO/SL/CE et des règles de tirage dont les niveaux contiennent assez de questions avec leurs quatre choix et `correct_option` ; vérifiez que le total vaut 34/23/34.
2. Ouvrez l’examen gratuit en visiteur, cliquez **Non** sur l’identité et vérifiez qu’aucune ligne `attempts` n’est créée. Relancez, cliquez **Oui**, puis vérifiez que les questions proviennent de Supabase et que `attempts.question_ids` contient 91 UUID et que `attempts.question_points` contient 91 valeurs alignées.
3. Répondez à plusieurs questions, actualisez la page et vérifiez que le même `attempts.id`, le même tirage et les réponses de `answers` sont restaurés. Démarrez une autre tentative et comparez les tirages (chaque tentative est aléatoire).
4. Configurez un entitlement actif avec crédits positifs et démarrez le payant : le crédit doit diminuer d’un seul, au moment du clic **Oui**. Répétez avec accès expiré, révoqué et crédit nul : l’API doit refuser sans créer une tentative. Le gratuit doit rester accessible sans connexion.
5. Dans l’onglet Réseau, vérifiez les réponses de `/questions` : aucun champ `correct_option` ne doit être présent. Soumettez l’examen et vérifiez les lignes `answers.is_correct`, les trois résultats `results`, et les niveaux issus de `cefr_thresholds`.

## Paiement manuel BaridiMob (phase 4)

Configurez `NEXT_PUBLIC_BARIDIMOB_RIP`, `NEXT_PUBLIC_BARIDIMOB_ACCOUNT_NAME` et `NEXT_PUBLIC_WHATSAPP_NUMBER` pour afficher les coordonnées de virement et construire le lien WhatsApp. Pour les emails transactionnels, configurez `RESEND_API_KEY`, un expéditeur vérifié dans `RESEND_FROM_EMAIL` et `ADMIN_NOTIFICATION_EMAIL` (destinataire de l’alerte pour chaque nouvelle demande). Les secrets Resend restent côté serveur ; les paramètres BaridiMob et WhatsApp sont publics.

Le parcours candidat est `/tarifs` → **Choisir cette offre** → `/paiement/[id]` → envoi du reçu WhatsApp → `/mes-acces`. Une seule demande en attente est conservée par utilisateur et par forfait ; les clics suivants réutilisent sa référence. Une demande en attente peut être annulée depuis `/mes-acces`. La page `/tarifs` affiche les forfaits actifs de la table `plans`, triés par `sort_order`. Les cartes montrent le badge, l’objectif, le type TCF, le prix en DA, le nombre de simulations et la validité, ainsi que les avantages `features`. La section **Offres** de `/admin` permet à l’administrateur de modifier ces informations, les crédits, la durée et la visibilité. L’administration recherche les demandes et gère les accès à `/admin/paiements`, où figurent aussi les 100 événements d’audit les plus récents avec l’identité de l’administrateur. L’approbation exige le numéro de transaction BaridiMob (unique) et crée l’accès dans la même transaction que le changement d’état et le journal d’audit. Les fonctions SQL administratives vérifient également `is_admin()` ; la RLS empêche les candidats de créer, modifier ou révoquer des accès.

Pour tester le parcours complet après application des migrations et configuration des variables :

1. Connectez-vous avec un compte utilisateur normal, publiez un examen gratuit et un examen payant, puis créez un plan actif avec `price_dzd`, un nombre positif de `exam_credits`, et `access_days`.
2. Ouvrez `/tarifs`, achetez le plan payant et vérifiez la référence `TCF-…`, le montant et les instructions BaridiMob. Le lien WhatsApp doit contenir le pack, l’email et la référence.
3. Vérifiez dans `/mes-acces` que la demande apparaît en attente. Tentez de démarrer l’examen payant avant activation : l’API doit refuser le démarrage ; un examen gratuit publié doit démarrer sans achat, même en visiteur.
4. Connectez-vous en admin, ouvrez `/admin/paiements`, recherchez une partie de l’email et activez la demande avec un numéro de transaction. Vérifiez l’accès et sa date d’expiration dans l’espace candidat. Réutiliser un numéro de transaction ou retraiter la même demande doit échouer.
5. Recommencez avec une autre demande et refusez-la avec un motif ; le candidat voit le motif. Testez aussi l’activation directe par email, la prolongation et la révocation depuis la liste des accès.
6. Vérifiez le journal **Journal d’audit récent** dans `/admin/paiements` : approbation, refus, octroi direct, prolongation et révocation doivent apparaître avec l’acteur, la référence et les métadonnées. Un compte utilisateur normal ne doit pas pouvoir lire le journal, appeler les fonctions admin, ni écrire directement dans `entitlements`.
7. Cliquez plusieurs fois rapidement sur **Choisir cette offre** et recommencez après avoir rechargé : une seule ligne pending doit exister pour ce plan, avec la même référence. Annulez-la depuis `/mes-acces`, puis recréez une demande pour confirmer qu’une nouvelle référence est attribuée. Créez parallèlement une demande pour un autre plan : elle doit rester autorisée.

## Contenu des examens (admin)

Une fois connecté avec un profil `admin`, ouvrez `/admin` pour créer un examen, lui ajouter des sections CO/SL/CE/EE/EO, puis gérer les questions à choix multiples. L’ordre affiché est fixe : CO, SL, CE, EE, EO. Le moteur d’examen actuel ne fait passer que CO, SL et CE ; EE/EO restent configurables dans l’admin pour une phase ultérieure. Les sections EE/EO acceptent des consignes de production avec limites de mots et durées de préparation/expression. Les fichiers audio CO sont MP3 ou WAV, au plus 20 Mo, et sont conservés dans le bucket privé `tcf-exam-audio`.

Pour ajouter plusieurs questions, sélectionnez une section CO/SL/CE puis **Importer CSV / JSON**. Les modèles téléchargeables se trouvent dans `public/templates/`. Les colonnes CSV sont `position,prompt,option_a,option_b,option_c,option_d,correct_option,explanation,level,points,duration_seconds`; les durées sont requises pour une section CO et laissées vides pour les autres. Le JSON utilise les mêmes champs avec `options` sous forme d’un tableau de quatre chaînes. Le bouton de confirmation affiche un aperçu avant l’écriture en base. Pour corriger les passages sans remplacer les questions, appliquez la migration `018_update_question_passages_by_position.sql`, sélectionnez **Mettre à jour uniquement les passages des positions existantes**, puis confirmez : seuls les passages sont modifiés, les identifiants sont conservés et l’import est annulé entièrement si une position du fichier n’existe pas dans la section. Cette option ne supprime aucune question, tentative ou résultat.

Dans **Authentication → URL Configuration**, ajoutez l’URL de l’application à la liste des URL autorisées. Activez la confirmation des adresses e-mail et configurez l’URL de redirection de confirmation et de réinitialisation pour revenir sur `/auth/callback`.

Après avoir créé et vérifié le compte de la personne administratrice, attribuez-lui le rôle `admin` depuis le SQL Editor Supabase en remplaçant l’adresse ci-dessous :

```sql
update public.profiles
set role = 'admin'
where user_id = (
  select id from auth.users where lower(email) = lower('admin@example.com')
);
```

Les comptes créés par le formulaire public obtiennent toujours le rôle `user`. `/admin` vérifie la session et le rôle côté serveur.

## Tableau de bord et statistiques (phase 6)

Le tableau `/dashboard` affiche uniquement les données Supabase du compte connecté. Il propose les onglets **Mes examens**, **Mes résultats** et **Mes accès et paiements**, les indicateurs de crédits/expiration/résultats, et une courbe temporelle du score global (moyenne uniquement lorsque CO, SL et CE sont tous présents) et des scores par épreuve. Sans historique, l’écran affiche notamment **« Aucune simulation passée pour le moment »** ; aucune donnée de démonstration n’est utilisée. La correction question par question est disponible sur `/dashboard/resultats/[attemptId]` uniquement après soumission ; l’API vérifie à nouveau la propriété et le statut côté serveur avant de renvoyer les bonnes réponses.

Le tableau `/admin` regroupe le nombre d’utilisateurs, inscriptions et simulations par jour sur 14 jours, demandes en attente, revenus des paiements activés en DA et scores moyens CO/SL/CE. Le menu admin affiche un badge des demandes en attente. L’accès aux agrégats est réservé à `admin_dashboard_analytics()` côté SQL.

Les emails transactionnels Resend sont en texte brut et en français : demande de paiement (référence, montant, RIP et liens de paiement/WhatsApp), activation (crédits et expiration), refus avec motif, expiration à trois jours, et notification admin à chaque nouvelle demande. Une erreur d’envoi est journalisée côté serveur sans annuler l’action enregistrée ; configurez `ADMIN_NOTIFICATION_EMAIL` pour recevoir les nouvelles demandes. Sur Vercel, le cron quotidien `0 9 * * *` appelle `/api/cron/expiring-entitlements` ; configurez `CRON_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY` et `RESEND_FROM_EMAIL`. La table `email_notification_log` déduplique les rappels et conserve leur état. Pour tester manuellement le cron, envoyez une requête GET avec `Authorization: Bearer <CRON_SECRET>` ; il ne traite que les accès valides dont l’expiration tombe entre 3 et 4 jours après le passage du cron.

Pour tester la phase 6, appliquez la migration 016 après la 015, puis la migration 019 après les migrations précédentes. Avec un compte candidat sans historique, vérifiez les listes vides et **« Aucune simulation passée pour le moment »** ; aucun résultat de démonstration ne doit apparaître. N’ajoutez pas de faux résultats : lorsque le moteur d’examen permettra une soumission, testez la courbe et le détail avec une véritable tentative soumise. Avant soumission, l’URL de correction doit refuser l’accès ; après soumission, elle doit afficher les choix, réponses, explications et points. En admin, vérifiez les comptes, tendances quotidiennes, paiements approuvés/en attente et scores par épreuve. Enfin, testez chaque email avec Resend, puis simulez un échec Resend : l’action doit rester enregistrée et l’erreur apparaître dans les logs.

## Vérifications

```bash
npm run lint
npm run build
```

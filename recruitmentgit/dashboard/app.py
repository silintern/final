import os
import io
import traceback
import sqlite3
import pandas as pd
import requests
from flask import Flask, jsonify, render_template, request, redirect, url_for, session, send_from_directory
from werkzeug.security import generate_password_hash, check_password_hash
from werkzeug.utils import secure_filename
from flask_cors import CORS
from collections import defaultdict, OrderedDict

# --- App Initialization ---
app = Flask(__name__)
# **MODIFICATION**: Configure CORS to allow requests to the API from any origin.
# This allows the standalone form to send data to the server.
CORS(app, resources={r"/api/*": {"origins": "*"}})
app.secret_key = os.environ.get('FLASK_SECRET_KEY', 'a-very-secure-and-random-default-key-123')

# --- Constants & Configuration ---
DATABASE = 'recruitment_final.db'
UPLOAD_FOLDER = 'uploads'
ALLOWED_EXTENSIONS = {'pdf'}
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER

DEFAULT_ADMIN_EMAIL = os.environ.get('ADMIN_EMAIL', 'admin@adventz.com')
DEFAULT_ADMIN_PASSWORD = os.environ.get('ADMIN_PASSWORD', '12345')
# Core fields that are essential and cannot be deleted by the admin
CORE_FIELDS = ['id', 'name', 'email', 'submission_timestamp', 'resume_path']

if not os.path.exists(UPLOAD_FOLDER):
    os.makedirs(UPLOAD_FOLDER)

def allowed_file(filename):
    return '.' in filename and \
           filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

# --- Database Management ---

def get_db_conn():
    """Establishes a connection to the SQLite database."""
    conn = sqlite3.connect(DATABASE, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    """Initializes and migrates database tables, creates form config, and default admin."""
    print("Initializing database...")
    with app.app_context():
        conn = get_db_conn()
        cursor = conn.cursor()
        
        # Check if custom sections already exist - if so, skip form config initialization
        try:
            custom_sections = cursor.execute("SELECT COUNT(*) FROM form_sections WHERE name = 'Personal Details'").fetchone()
            if custom_sections and custom_sections[0] > 0:
                print("Custom sections detected - skipping form config initialization")
                # Still create other tables but skip form config population
                cursor.execute('''
                    CREATE TABLE IF NOT EXISTS users (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        email TEXT UNIQUE NOT NULL,
                        password_hash TEXT NOT NULL,
                        role TEXT NOT NULL CHECK(role IN ('admin', 'viewer'))
                    )
                ''')
                cursor.execute('''
                    CREATE TABLE IF NOT EXISTS statuses (
                        email TEXT PRIMARY KEY,
                        name TEXT,
                        status TEXT NOT NULL
                    )
                ''')
                
                # Create form_config table if it doesn't exist
                cursor.execute('''
                    CREATE TABLE IF NOT EXISTS form_config (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        name TEXT UNIQUE NOT NULL,
                        label TEXT NOT NULL,
                        type TEXT NOT NULL,
                        subsection TEXT,
                        options TEXT,
                        required BOOLEAN NOT NULL DEFAULT 0,
                        is_core BOOLEAN NOT NULL DEFAULT 0,
                        field_order INTEGER DEFAULT 0,
                        validations TEXT
                    )
                ''')
                
                # Create form_sections table if it doesn't exist
                cursor.execute('''
                    CREATE TABLE IF NOT EXISTS form_sections (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        name TEXT UNIQUE NOT NULL,
                        section_order INTEGER DEFAULT 0,
                        description TEXT,
                        icon TEXT DEFAULT 'folder',
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                ''')
                
                conn.commit()
                conn.close()
                print("Database initialized successfully (custom sections preserved).")
                return
        except:
            pass  # Table doesn't exist yet, continue with normal initialization

        # --- User and Status Tables ---
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL CHECK(role IN ('admin', 'viewer'))
            )
        ''')
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS statuses (
                email TEXT PRIMARY KEY,
                name TEXT,
                status TEXT NOT NULL
            )
        ''')

        # --- Dynamic Form Configuration Table ---
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS form_config (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT UNIQUE NOT NULL,
                label TEXT NOT NULL,
                type TEXT NOT NULL,
                subsection TEXT,
                options TEXT,
                required BOOLEAN NOT NULL DEFAULT 0,
                is_core BOOLEAN NOT NULL DEFAULT 0,
                field_order INTEGER DEFAULT 0
            )
        ''')

        # --- Migration check for new columns in form_config ---
        cursor.execute("PRAGMA table_info(form_config)")
        columns = [col['name'] for col in cursor.fetchall()]
        if 'subsection' not in columns:
            print("Migrating form_config: Adding 'subsection' column...")
            cursor.execute("ALTER TABLE form_config ADD COLUMN subsection TEXT")
        if 'field_order' not in columns:
            print("Migrating form_config: Adding 'field_order' column...")
            cursor.execute("ALTER TABLE form_config ADD COLUMN field_order INTEGER DEFAULT 0")
        if 'validations' not in columns:
            print("Migrating form_config: Adding 'validations' column...")
            cursor.execute("ALTER TABLE form_config ADD COLUMN validations TEXT DEFAULT '{}'")


        # --- Applications Table (Initially simple, will be altered by form config) ---
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS applications (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT,
                email TEXT UNIQUE,
                submission_timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                resume_path TEXT
            )
        ''')
        
        cursor.execute("PRAGMA table_info(applications)")
        app_columns = [col['name'] for col in cursor.fetchall()]
        if 'resume_path' not in app_columns:
            print("Migrating applications: Adding 'resume_path' column...")
            cursor.execute("ALTER TABLE applications ADD COLUMN resume_path TEXT")
        # Add migration for photo_path
        if 'photo_path' not in app_columns:
            print("Migrating applications: Adding 'photo_path' column...")
            cursor.execute("ALTER TABLE applications ADD COLUMN photo_path TEXT")


        # --- Populate Form Config if it's empty ---
        cursor.execute("SELECT COUNT(id) as count FROM form_config")
        if cursor.fetchone()['count'] == 0:
            print("Form config is empty. Populating with fields from recruitment-form.html...")
            
            # This list is now based on the user-provided recruitment-form.html
            default_fields = [
                # Personal Details
                {'name': 'name', 'label': 'Full Name', 'type': 'text', 'subsection': 'Personal Details', 'required': 1, 'is_core': 1},
                {'name': 'email', 'label': 'Email Address', 'type': 'email', 'subsection': 'Personal Details', 'required': 1, 'is_core': 1},
                {'name': 'dob', 'label': 'Date of Birth', 'type': 'date', 'subsection': 'Personal Details', 'required': 1},
                {'name': 'place_of_birth', 'label': 'Place of Birth', 'type': 'text', 'subsection': 'Personal Details', 'required': 0},
                {'name': 'gender', 'label': 'Gender', 'type': 'select', 'options': 'Male, Female, Other', 'subsection': 'Personal Details', 'required': 0},
                {'name': 'nationality', 'label': 'Nationality', 'type': 'text', 'subsection': 'Personal Details', 'required': 0},
                {'name': 'father_name', 'label': "Father's Name", 'type': 'text', 'subsection': 'Personal Details', 'required': 0},
                {'name': 'blood_group', 'label': 'Blood Group', 'type': 'select', 'options': 'A+, A-, B+, B-, AB+, AB-, O+, O-', 'subsection': 'Personal Details', 'required': 0},
                {'name': 'pan_card', 'label': 'PAN Card Number', 'type': 'text', 'subsection': 'Personal Details', 'required': 0},
                {'name': 'marital_status', 'label': 'Marital Status', 'type': 'select', 'options': 'Single, Married, Divorced, Widowed', 'subsection': 'Personal Details', 'required': 0},
                
                # Spouse's Details
                {'name': 'spouse_name', 'label': "Spouse's Name", 'type': 'text', 'subsection': "Spouse's Details", 'required': 0},
                {'name': 'spouse_employment', 'label': "Spouse's Employment Status", 'type': 'text', 'subsection': "Spouse's Details", 'required': 0},
                {'name': 'spouse_work_details', 'label': 'Spouse Work Details', 'type': 'textarea', 'subsection': "Spouse's Details", 'required': 0},
                {'name': 'children_count', 'label': 'Number of Children', 'type': 'number', 'subsection': "Spouse's Details", 'required': 0},

                # Contact & Position
                {'name': 'mobile_number', 'label': 'Mobile Number', 'type': 'tel', 'subsection': 'Contact & Position', 'required': 1},
                {'name': 'business_entity', 'label': 'Business Entity', 'type': 'select', 'options': 'SIL, ZIL, ZMSL, ZIIL', 'subsection': 'Contact & Position', 'required': 0},
                {'name': 'post_applying_for', 'label': 'Post Applying For', 'type': 'select', 'options': 'Intern, Civil Engineer, Graduate Engineer Trainee, Software Developer Trainee, Data Analyst Trainee, Business Development Executive, Human Resources Trainee, Marketing Trainee', 'subsection': 'Contact & Position', 'required': 0},
                {'name': 'location_of_position', 'label': 'Location of Position', 'type': 'select', 'options': 'Gurugram, Pune, Bangalore', 'subsection': 'Contact & Position', 'required': 0},
                {'name': 'present_address', 'label': 'Present Address', 'type': 'textarea', 'subsection': 'Contact & Position', 'required': 1},
                {'name': 'permanent_address', 'label': 'Permanent Address', 'type': 'textarea', 'subsection': 'Contact & Position', 'required': 0},
                {'name': 'hobbies', 'label': 'Hobbies / Leisure Activities', 'type': 'text', 'subsection': 'Contact & Position', 'required': 0},

                # Academic Qualifications
                {'name': 'qualification_10th_school', 'label': '10th School/College', 'type': 'text', 'subsection': 'Academic Qualifications', 'required': 0},
                {'name': 'qualification_10th_board', 'label': '10th Board', 'type': 'text', 'subsection': 'Academic Qualifications', 'required': 0},
                {'name': 'qualification_10th_subjects', 'label': '10th Main Subjects', 'type': 'text', 'subsection': 'Academic Qualifications', 'required': 0},
                {'name': 'qualification_10th_year', 'label': '10th Year of Passing', 'type': 'text', 'subsection': 'Academic Qualifications', 'required': 0},
                {'name': 'qualification_10th_marks', 'label': '10th % Marks / CGPA', 'type': 'text', 'subsection': 'Academic Qualifications', 'required': 0},
                {'name': 'qualification_10th_division', 'label': '10th Division/Class', 'type': 'text', 'subsection': 'Academic Qualifications', 'required': 0},
                
                {'name': 'qualification_12th_school', 'label': '12th School/College', 'type': 'text', 'subsection': 'Academic Qualifications', 'required': 0},
                {'name': 'qualification_12th_board', 'label': '12th Board/University', 'type': 'text', 'subsection': 'Academic Qualifications', 'required': 0},
                {'name': 'qualification_12th_specialization', 'label': '12th Course Specialization', 'type': 'text', 'subsection': 'Academic Qualifications', 'required': 0},
                {'name': 'qualification_12th_year', 'label': '12th Year of Passing', 'type': 'text', 'subsection': 'Academic Qualifications', 'required': 0},
                {'name': 'qualification_12th_marks', 'label': '12th % Marks / CGPA', 'type': 'text', 'subsection': 'Academic Qualifications', 'required': 0},
                {'name': 'qualification_12th_division', 'label': '12th Division/Class', 'type': 'text', 'subsection': 'Academic Qualifications', 'required': 0},

                {'name': 'qualification_grad_school', 'label': 'Graduation Institute/College', 'type': 'text', 'subsection': 'Academic Qualifications', 'required': 0},
                {'name': 'qualification_grad_course', 'label': 'Graduation Course', 'type': 'text', 'subsection': 'Academic Qualifications', 'required': 0},
                {'name': 'qualification_grad_specialization', 'label': 'Graduation Course Specialization', 'type': 'text', 'subsection': 'Academic Qualifications', 'required': 0},
                {'name': 'qualification_grad_year', 'label': 'Graduation Year of Passing', 'type': 'text', 'subsection': 'Academic Qualifications', 'required': 0},
                {'name': 'qualification_grad_marks', 'label': 'Graduation % Marks / CGPA', 'type': 'text', 'subsection': 'Academic Qualifications', 'required': 0},
                {'name': 'qualification_grad_division', 'label': 'Graduation Division/Class', 'type': 'text', 'subsection': 'Academic Qualifications', 'required': 0},

                {'name': 'qualification_pg_school', 'label': 'Post-Graduation Institute/College', 'type': 'text', 'subsection': 'Academic Qualifications', 'required': 0},
                {'name': 'qualification_pg_course', 'label': 'Post-Graduation Course', 'type': 'text', 'subsection': 'Academic Qualifications', 'required': 0},
                {'name': 'qualification_pg_specialization', 'label': 'Post-Graduation Course Specialization', 'type': 'text', 'subsection': 'Academic Qualifications', 'required': 0},
                {'name': 'qualification_pg_year', 'label': 'Post-Graduation Year of Passing', 'type': 'text', 'subsection': 'Academic Qualifications', 'required': 0},
                {'name': 'qualification_pg_marks', 'label': 'Post-Graduation % Marks / CGPA', 'type': 'text', 'subsection': 'Academic Qualifications', 'required': 0},
                {'name': 'qualification_pg_division', 'label': 'Post-Graduation Division/Class', 'type': 'text', 'subsection': 'Academic Qualifications', 'required': 0},

                # Additional Information
                {'name': 'previously_applied', 'label': 'Have you applied with us earlier?', 'type': 'radio', 'options': 'Yes, No', 'subsection': 'Additional Information', 'required': 0},
                {'name': 'related_employee', 'label': 'Are you related to any employee?', 'type': 'radio', 'options': 'Yes, No', 'subsection': 'Additional Information', 'required': 0},
                {'name': 'related_employee_details', 'label': 'If yes, provide details', 'type': 'textarea', 'subsection': 'Additional Information', 'required': 0},
                {'name': 'legal_cases', 'label': 'Are there any criminal/civil cases against you?', 'type': 'radio', 'options': 'Yes, No', 'subsection': 'Additional Information', 'required': 0},
                {'name': 'legal_cases_details', 'label': 'If yes, provide details', 'type': 'textarea', 'subsection': 'Additional Information', 'required': 0},
            ]

            cursor.execute("PRAGMA table_info(applications)")
            existing_columns = [row['name'] for row in cursor.fetchall()]

            for i, field in enumerate(default_fields):
                field.setdefault('is_core', 0)
                field.setdefault('options', None)
                field.setdefault('required', 0)
                
                if field['name'] not in existing_columns:
                    try:
                        cursor.execute(f"ALTER TABLE applications ADD COLUMN {field['name']} TEXT")
                        print(f"Added column '{field['name']}' to applications table.")
                    except sqlite3.OperationalError as e:
                        print(f"Could not add column {field['name']}: {e}")
                
                cursor.execute(
                    "INSERT INTO form_config (name, label, type, subsection, options, required, is_core, field_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                    (field['name'], field['label'], field['type'], field['subsection'], field.get('options'), field['required'], field['is_core'], i)
                )
            print("Default form config populated with all fields.")

        # --- Create Default Admin ---
        cursor.execute("SELECT id FROM users WHERE role = 'admin' LIMIT 1")
        if cursor.fetchone() is None:
            print(f"No admin user found. Creating default admin: {DEFAULT_ADMIN_EMAIL}")
            hashed_password = generate_password_hash(DEFAULT_ADMIN_PASSWORD)
            cursor.execute("INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)", (DEFAULT_ADMIN_EMAIL, hashed_password, 'admin'))
        
        conn.commit()
        conn.close()
        print("Database initialized successfully.")

# --- Web Routes ---

@app.route('/')
def route_home():
    return redirect(url_for('route_admin_login'))

@app.route('/login', methods=['GET', 'POST'])
def route_admin_login():
    if request.method == 'POST':
        email = request.form.get('email')
        password = request.form.get('password')
        if not email or not password:
            return render_template('login.html', error='Email and password are required.')
        conn = get_db_conn()
        user = conn.execute('SELECT * FROM users WHERE email = ?', (email,)).fetchone()
        conn.close()
        if user and check_password_hash(user['password_hash'], password):
            session.clear()
            session['user_id'] = user['id']
            session['user_email'] = user['email']
            session['user_role'] = user['role']
            return redirect(url_for('route_dashboard'))
        else:
            return render_template('login.html', error='Invalid email or password.')
    return render_template('login.html')

@app.route('/dashboard')
def route_dashboard():
    if 'user_id' not in session:
        return redirect(url_for('route_admin_login'))
    return render_template('index.html', role=session.get('user_role', 'viewer'))

@app.route('/logout')
def route_logout():
    session.clear()
    return redirect(url_for('route_admin_login'))

@app.route('/uploads/<filename>')
def uploaded_file(filename):
    # Serve photos from the photos folder if the filename is an image
    photo_exts = {'png', 'jpg', 'jpeg'}
    ext = filename.rsplit('.', 1)[-1].lower()
    if ext in photo_exts:
        photo_folder = os.path.join('static', 'uploads', 'photos')
        return send_from_directory(photo_folder, filename)
    return send_from_directory(app.config['UPLOAD_FOLDER'], filename)

# --- API Endpoints ---

@app.route('/api/data')
def api_get_data():
    if 'user_id' not in session:
        return jsonify({"error": "Authentication required."}), 401
    try:
        conn = get_db_conn()
        df = pd.read_sql_query("SELECT * FROM applications", conn)
        if df.empty:
            conn.close()
            return jsonify({"kpis": {}, "charts": {}, "table_data": [], "all_columns": [], "default_columns": [], "filters": {}})

        df['email'] = df['email'].astype(str).str.lower().fillna('')
        statuses_df = pd.read_sql_query("SELECT lower(email) as email, status FROM statuses", conn)
        conn.close()

        status_map = {row['email']: row['status'] for _, row in statuses_df.iterrows()} if not statuses_df.empty else {}
        df['Status'] = df.apply(lambda row: status_map.get(row.get('email', '').lower(), 'Applied'), axis=1)

        COLUMNS = {
            'STATUS': 'Status', 'GENDER': 'gender', 'DATE': 'submission_timestamp', 'NAME': 'name',
            'COMPANY': 'business_entity', 'COLLEGE': 'qualification_grad_school',
            'LOCATION': 'location_of_position', 'POST': 'post_applying_for',
            'QUALIFICATION': 'qualification_grad_course', 'COURSE': 'qualification_grad_course'
        }
        
        filters_applied = {key: request.args.get(key) for key in request.args}
        if COLUMNS['DATE'] in df.columns:
            df[COLUMNS['DATE']] = pd.to_datetime(df[COLUMNS['DATE']], errors='coerce')
            if filters_applied.get('start_date'):
                df = df[df[COLUMNS['DATE']] >= pd.to_datetime(filters_applied['start_date'])]
            if filters_applied.get('end_date'):
                df = df[df[COLUMNS['DATE']] <= pd.to_datetime(filters_applied['end_date'])]

        def apply_filter(dataframe, col_name, value):
            if value and value != 'all' and col_name in dataframe.columns:
                return dataframe[dataframe[col_name].astype(str) == value]
            return dataframe

        for key, col in [('location', COLUMNS['LOCATION']), ('post', COLUMNS['POST']), ('qualification', COLUMNS['QUALIFICATION']), ('business_entity', COLUMNS['COMPANY']), ('course', COLUMNS['COURSE']), ('college', COLUMNS['COLLEGE'])]:
            df = apply_filter(df, col, filters_applied.get(key))
        
        status_counts = df[COLUMNS['STATUS']].value_counts()
        kpis = {
            'applications': len(df), 'shortlisted': int(status_counts.get('Shortlisted', 0)),
            'interviewed': int(status_counts.get('Interviewed', 0)), 'offered': int(status_counts.get('Offered', 0)),
            'hired': int(status_counts.get('Hired', 0)), 'rejected': int(status_counts.get('Rejected', 0)),
        }
        kpis['acceptance_rate'] = round(((kpis['hired'] + kpis['offered'])/kpis['applications'] ) * 100 if kpis['offered'] > 0 else 0, 2)
        kpis['rejection_rate'] = round((kpis['rejected'] / len(df)) * 100 if len(df) > 0 else 0, 2)

        charts = {
            'apps_per_company': df[COLUMNS['COMPANY']].value_counts().to_dict() if COLUMNS['COMPANY'] in df.columns else {},
            'apps_per_college': df[COLUMNS['COLLEGE']].value_counts().to_dict() if COLUMNS['COLLEGE'] in df.columns else {},
            'gender_diversity': df[COLUMNS['GENDER']].value_counts().to_dict() if COLUMNS['GENDER'] in df.columns else {},
            'recruitment_funnel': {'labels': ['Applications', 'Shortlisted', 'Interviewed', 'Offered', 'Hired'], 'data': [kpis['applications'], kpis['shortlisted'], kpis['interviewed'], kpis['offered'], kpis['hired']]}
        }

        for col in df.columns:
            if pd.api.types.is_datetime64_any_dtype(df[col]):
                df[col] = df[col].dt.strftime('%Y-%m-%d %H:%M:%S')
        df.fillna('', inplace=True)
        all_columns = df.columns.tolist()
        if 'name' in all_columns:
            all_columns.insert(0, all_columns.pop(all_columns.index('name')))
        
        # Add photo_path to default columns if present
        default_columns = [col for col in ['name', 'email', 'post_applying_for', 'qualification_grad_school', 'Status', 'resume_path', 'photo_path'] if col in all_columns]
        table_data = df.to_dict(orient='records')

        def get_unique_values(col_name):
            return sorted(df[col_name].dropna().unique().tolist()) if col_name in df.columns else []
        
        filters = {
            'locations': get_unique_values(COLUMNS['LOCATION']), 'posts': get_unique_values(COLUMNS['POST']),
            'qualifications': get_unique_values(COLUMNS['QUALIFICATION']), 'business_entities': get_unique_values(COLUMNS['COMPANY']),
            'courses': get_unique_values(COLUMNS['COURSE']), 'colleges': get_unique_values(COLUMNS['COLLEGE'])
        }

        return jsonify({"kpis": kpis, "charts": charts, "table_data": table_data, "all_columns": all_columns, "default_columns": default_columns, "filters": filters})
    except Exception as e:
        print(f"--- API ERROR in /api/data ---\n{traceback.format_exc()}")
        return jsonify({"error": "An error occurred on the server.", "message": str(e)}), 500

@app.route('/api/submit_application', methods=['POST'])
def api_submit_application():
    if 'cv-resume' not in request.files:
        return jsonify({"error": "No resume file part"}), 400
    
    file = request.files['cv-resume']
    if file.filename == '':
        return jsonify({"error": "No selected file"}), 400

    # Handle photo upload
    photo_filename = None
    if 'photo-upload' in request.files:
        photo = request.files['photo-upload']
        if photo and photo.filename != '':
            allowed_photo_exts = {'png', 'jpg', 'jpeg'}
            ext = photo.filename.rsplit('.', 1)[-1].lower()
            if ext not in allowed_photo_exts:
                return jsonify({"error": "Photo must be .png, .jpg, or .jpeg"}), 400
            if photo.content_length and photo.content_length > 5 * 1024 * 1024:
                return jsonify({"error": "Photo size exceeds 5MB limit."}), 400
            # Save photo
            email = request.form.get('email', 'unknown')
            photo_filename = f"{secure_filename(email)}_photo.{ext}"
            photo_folder = os.path.join('static', 'uploads', 'photos')
            os.makedirs(photo_folder, exist_ok=True)
            photo.save(os.path.join(photo_folder, photo_filename))

    if file and allowed_file(file.filename):
        filename = secure_filename(file.filename)
        # To avoid overwrites, prepend a unique identifier or use a better strategy
        # For simplicity, we'll use email + original filename
        email = request.form.get('email', 'unknown')
        unique_filename = f"{secure_filename(email)}_{filename}"
        
        file_path = os.path.join(app.config['UPLOAD_FOLDER'], unique_filename)
        file.save(file_path)

        data = request.form.to_dict()
        data['resume_path'] = unique_filename # Store the path to be saved in DB
        if photo_filename:
            data['photo_path'] = photo_filename
        
        conn = get_db_conn()
        try:
            form_fields = conn.execute("SELECT name FROM form_config").fetchall()
            valid_columns = {field['name'] for field in form_fields}
            valid_columns.add('resume_path') # Add resume_path to valid columns
            valid_columns.add('photo_path') # Add photo_path to valid columns
            
            columns_to_insert = [col for col in data.keys() if col in valid_columns]
            values_to_insert = [data[col] for col in columns_to_insert]
            
            if not columns_to_insert:
                return jsonify({"error": "No valid data received."}), 400

            placeholders = ', '.join(['?'] * len(columns_to_insert))
            query = f"INSERT INTO applications ({', '.join(columns_to_insert)}) VALUES ({placeholders})"
            
            cursor = conn.cursor()
            cursor.execute(query, values_to_insert)
            conn.commit()
            return jsonify({"success": True, "message": "Application submitted successfully."})
        except sqlite3.IntegrityError:
            return jsonify({"error": f"An application with the email '{data.get('email')}' already exists."}), 409
        except Exception as e:
            print(f"--- API ERROR in /api/submit_application ---\n{traceback.format_exc()}")
            return jsonify({"error": "An error occurred on the server.", "message": str(e)}), 500
        finally:
            conn.close()
    else:
        return jsonify({"error": "File type not allowed"}), 400


# --- Form Configuration APIs ---

@app.route('/api/public/form-config', methods=['GET'])
def get_public_form_config():
    """A public endpoint to fetch the form structure for any applicant."""
    conn = get_db_conn()
    
    # Get section order from form_sections table if it exists
    section_order = {}
    try:
        sections_query = conn.execute("SELECT name, section_order FROM form_sections ORDER BY section_order ASC").fetchall()
        section_order = {row['name']: row['section_order'] for row in sections_query}
    except:
        pass  # Table doesn't exist yet
    
    fields_query = conn.execute("SELECT * FROM form_config ORDER BY field_order ASC").fetchall()
    conn.close()
    
    # Group fields by subsection for easier rendering in the template
    subsections = defaultdict(list)
    for field in fields_query:
        subsections[field['subsection']].append(dict(field))
    
    # Order subsections by section_order if available, otherwise by first field's order
    if section_order:
        # Sort by section order, putting unordered sections at the end
        subsection_order = sorted(subsections.keys(), key=lambda k: section_order.get(k, 9999))
    else:
        # Fallback: maintain the order of subsections based on the first field's order in each
        subsection_order = sorted(subsections.keys(), key=lambda k: subsections[k][0]['field_order'])
    
    ordered_subsections = OrderedDict()
    for k in subsection_order:
        ordered_subsections[k] = subsections[k]
    
    # Use Flask's Response with json.dumps to preserve order
    import json
    response = app.response_class(
        response=json.dumps(ordered_subsections, separators=(',', ':')),
        status=200,
        mimetype='application/json'
    )
    return response


@app.route('/api/form/config', methods=['GET'])
def get_form_config():
    if session.get('user_role') != 'admin': return jsonify({"error": "Admin access required."}), 403
    conn = get_db_conn()
    fields = conn.execute("SELECT * FROM form_config ORDER BY field_order ASC").fetchall()
    conn.close()
    return jsonify([dict(row) for row in fields])

@app.route('/api/form/config', methods=['POST'])
def add_form_field():
    if session.get('user_role') != 'admin': return jsonify({"error": "Admin access required."}), 403
    data = request.json
    field_name = data.get('name', '').strip().replace(' ', '_').lower()
    field_label = data.get('label')
    field_type = data.get('type')
    subsection = data.get('subsection')
    options = data.get('options')
    required = data.get('required', False)
    validations = data.get('validations', '{}')  # JSON string for validation rules

    if not all([field_name, field_label, field_type, subsection]):
        return jsonify({"error": "Name, label, type, and subsection are required."}), 400

    conn = get_db_conn()
    try:
        # Get the highest field_order to append at the end
        cursor = conn.cursor()
        cursor.execute("SELECT MAX(field_order) as max_order FROM form_config")
        max_order = cursor.fetchone()['max_order'] or 0
        new_order = max_order + 1

        # Add column to applications table
        cursor.execute(f"ALTER TABLE applications ADD COLUMN {field_name} TEXT")
        
        # Insert into form_config
        cursor.execute(
            "INSERT INTO form_config (name, label, type, subsection, options, required, validations, field_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (field_name, field_label, field_type, subsection, options, required, validations, new_order)
        )
        conn.commit()
        return jsonify({"success": True, "message": "Field added successfully."})
    except sqlite3.OperationalError as e:
        if 'duplicate column name' in str(e):
            return jsonify({"error": f"A column named '{field_name}' already exists in the database."}), 409
        else:
            raise
    except sqlite3.IntegrityError:
        return jsonify({"error": f"A field with the name '{field_name}' already exists."}), 409
    except Exception as e:
        print(f"--- API ERROR in /api/form/config [POST] ---\n{traceback.format_exc()}")
        return jsonify({"error": "Server error while adding field.", "message": str(e)}), 500
    finally:
        conn.close()

@app.route('/api/form/config/<int:field_id>', methods=['PUT'])
def update_form_field(field_id):
    if session.get('user_role') != 'admin': return jsonify({"error": "Admin access required."}), 403
    data = request.json
    
    conn = get_db_conn()
    try:
        field = conn.execute("SELECT * FROM form_config WHERE id = ?", (field_id,)).fetchone()
        if not field: return jsonify({"error": "Field not found."}), 404

        # Update field configuration - only update provided fields
        cursor = conn.cursor()
        
        # Build dynamic query based on provided data
        update_fields = []
        update_values = []
        
        if 'label' in data:
            update_fields.append('label = ?')
            update_values.append(data['label'])
        
        if 'type' in data:
            update_fields.append('type = ?')
            update_values.append(data['type'])
            
        if 'subsection' in data:
            update_fields.append('subsection = ?')
            update_values.append(data['subsection'])
            
        if 'options' in data:
            update_fields.append('options = ?')
            update_values.append(data['options'])
            
        if 'required' in data:
            update_fields.append('required = ?')
            update_values.append(data['required'])
            
        if 'validations' in data:
            update_fields.append('validations = ?')
            update_values.append(data['validations'])
        
        if not update_fields:
            return jsonify({"error": "No fields to update."}), 400
            
        # Add field_id to the end of values
        update_values.append(field_id)
        
        query = f"UPDATE form_config SET {', '.join(update_fields)} WHERE id = ?"
        cursor.execute(query, update_values)
        conn.commit()
        return jsonify({"success": True, "message": "Field updated successfully."})
    except Exception as e:
        print(f"--- API ERROR in /api/form/config [PUT] ---")
        print(f"Field ID: {field_id}")
        print(f"Request data: {data}")
        print(f"Error: {str(e)}")
        print(f"Traceback:\n{traceback.format_exc()}")
        return jsonify({"error": "Server error while updating field.", "message": str(e)}), 500
    finally:
        conn.close()

@app.route('/api/form/config/<int:field_id>', methods=['DELETE'])
def delete_form_field(field_id):
    if session.get('user_role') != 'admin': return jsonify({"error": "Admin access required."}), 403
    conn = get_db_conn()
    try:
        field = conn.execute("SELECT * FROM form_config WHERE id = ?", (field_id,)).fetchone()
        if not field: return jsonify({"error": "Field not found."}), 404
        if field['is_core']: return jsonify({"error": "Core fields cannot be deleted."}), 400

        field_name = field['name']
        
        cursor = conn.cursor()
        cursor.execute("PRAGMA table_info(applications)")
        columns_info = cursor.fetchall()
        column_defs = [f"{c['name']} {c['type']}" for c in columns_info if c['name'] != field_name]
        column_names = [c['name'] for c in columns_info if c['name'] != field_name]

        cursor.execute("BEGIN TRANSACTION")
        cursor.execute(f"CREATE TABLE applications_new ({', '.join(column_defs)})")
        cursor.execute(f"INSERT INTO applications_new ({', '.join(column_names)}) SELECT {', '.join(column_names)} FROM applications")
        cursor.execute("DROP TABLE applications")
        cursor.execute("ALTER TABLE applications_new RENAME TO applications")
        
        cursor.execute("DELETE FROM form_config WHERE id = ?", (field_id,))
        conn.commit()
        return jsonify({"success": True, "message": "Field deleted successfully."})
    except Exception as e:
        conn.rollback()
        print(f"--- API ERROR in /api/form/config [DELETE] ---\n{traceback.format_exc()}")
        return jsonify({"error": "Server error while deleting field.", "message": str(e)}), 500
    finally:
        conn.close()

@app.route('/api/form/config/reorder', methods=['POST'])
def reorder_form_fields():
    if session.get('user_role') != 'admin': return jsonify({"error": "Admin access required."}), 403
    field_orders = request.json.get('field_orders', [])
    
    conn = get_db_conn()
    try:
        cursor = conn.cursor()
        for field_id, new_order in field_orders:
            cursor.execute("UPDATE form_config SET field_order = ? WHERE id = ?", (new_order, field_id))
        conn.commit()
        return jsonify({"success": True, "message": "Field order updated successfully."})
    except Exception as e:
        print(f"--- API ERROR in /api/form/config/reorder ---\n{traceback.format_exc()}")
        return jsonify({"error": "Server error while reordering fields.", "message": str(e)}), 500
    finally:
        conn.close()

@app.route('/api/form/sections', methods=['GET'])
def get_form_sections():
    if session.get('user_role') != 'admin': return jsonify({"error": "Admin access required."}), 403
    conn = get_db_conn()
    
    # Get sections from the sections table if it exists, otherwise fall back to distinct subsections
    try:
        sections = conn.execute("""
            SELECT name, section_order, description, icon 
            FROM form_sections 
            ORDER BY section_order, name
        """).fetchall()
        
        if sections:
            conn.close()
            return jsonify([{
                'name': row['name'],
                'order': row['section_order'],
                'description': row['description'],
                'icon': row['icon']
            } for row in sections])
    except:
        pass  # Table doesn't exist yet, fall back to old method
    
    # Fallback: get distinct subsections from form_config
    sections = conn.execute("SELECT DISTINCT subsection FROM form_config WHERE subsection IS NOT NULL ORDER BY subsection").fetchall()
    conn.close()
    return jsonify([row['subsection'] for row in sections])

@app.route('/api/form/sections', methods=['POST'])
def create_form_section():
    if session.get('user_role') != 'admin': return jsonify({"error": "Admin access required."}), 403
    
    data = request.json
    name = data.get('name', '').strip()
    description = data.get('description', '').strip()
    icon = data.get('icon', 'folder').strip()
    
    if not name:
        return jsonify({"error": "Section name is required."}), 400
    
    conn = get_db_conn()
    try:
        # Ensure sections table exists
        conn.execute("""
            CREATE TABLE IF NOT EXISTS form_sections (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT UNIQUE NOT NULL,
                section_order INTEGER DEFAULT 0,
                description TEXT,
                icon TEXT DEFAULT 'folder',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        
        # Get next order
        max_order = conn.execute("SELECT COALESCE(MAX(section_order), 0) FROM form_sections").fetchone()[0]
        next_order = max_order + 1
        
        # Insert new section
        conn.execute("""
            INSERT INTO form_sections (name, section_order, description, icon)
            VALUES (?, ?, ?, ?)
        """, (name, next_order, description, icon))
        
        conn.commit()
        return jsonify({"success": True, "message": "Section created successfully."})
        
    except sqlite3.IntegrityError:
        return jsonify({"error": "Section with this name already exists."}), 400
    except Exception as e:
        print(f"--- API ERROR in /api/form/sections [POST] ---\n{traceback.format_exc()}")
        return jsonify({"error": "Server error while creating section.", "message": str(e)}), 500
    finally:
        conn.close()

@app.route('/api/form/sections/<section_name>', methods=['PUT'])
def update_form_section(section_name):
    if session.get('user_role') != 'admin': return jsonify({"error": "Admin access required."}), 403
    
    data = request.json
    new_name = data.get('name', '').strip()
    description = data.get('description', '').strip()
    icon = data.get('icon', 'folder').strip()
    
    conn = get_db_conn()
    try:
        # Ensure sections table exists
        conn.execute("""
            CREATE TABLE IF NOT EXISTS form_sections (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT UNIQUE NOT NULL,
                section_order INTEGER DEFAULT 0,
                description TEXT,
                icon TEXT DEFAULT 'folder',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        
        # Check if section exists in sections table
        existing = conn.execute("SELECT id FROM form_sections WHERE name = ?", (section_name,)).fetchone()
        
        if existing:
            # Update existing section
            conn.execute("""
                UPDATE form_sections 
                SET name = ?, description = ?, icon = ?
                WHERE name = ?
            """, (new_name or section_name, description, icon, section_name))
        else:
            # Create new section entry for existing subsection
            max_order = conn.execute("SELECT COALESCE(MAX(section_order), 0) FROM form_sections").fetchone()[0]
            conn.execute("""
                INSERT INTO form_sections (name, section_order, description, icon)
                VALUES (?, ?, ?, ?)
            """, (new_name or section_name, max_order + 1, description, icon))
        
        # If name changed, update all fields with old section name
        if new_name and new_name != section_name:
            conn.execute("""
                UPDATE form_config 
                SET subsection = ?
                WHERE subsection = ?
            """, (new_name, section_name))
        
        conn.commit()
        return jsonify({"success": True, "message": "Section updated successfully."})
        
    except sqlite3.IntegrityError:
        return jsonify({"error": "Section with this name already exists."}), 400
    except Exception as e:
        print(f"--- API ERROR in /api/form/sections/{section_name} [PUT] ---\n{traceback.format_exc()}")
        return jsonify({"error": "Server error while updating section.", "message": str(e)}), 500
    finally:
        conn.close()

@app.route('/api/form/sections/<section_name>', methods=['DELETE'])
def delete_form_section(section_name):
    if session.get('user_role') != 'admin': return jsonify({"error": "Admin access required."}), 403
    
    conn = get_db_conn()
    try:
        # Check if section has fields
        fields_count = conn.execute("SELECT COUNT(*) FROM form_config WHERE subsection = ?", (section_name,)).fetchone()[0]
        
        if fields_count > 0:
            return jsonify({"error": f"Cannot delete section '{section_name}' because it contains {fields_count} field(s). Please move or delete the fields first."}), 400
        
        # Delete from sections table if it exists
        try:
            conn.execute("DELETE FROM form_sections WHERE name = ?", (section_name,))
        except:
            pass  # Table might not exist
        
        conn.commit()
        return jsonify({"success": True, "message": "Section deleted successfully."})
        
    except Exception as e:
        print(f"--- API ERROR in /api/form/sections/{section_name} [DELETE] ---\n{traceback.format_exc()}")
        return jsonify({"error": "Server error while deleting section.", "message": str(e)}), 500
    finally:
        conn.close()

@app.route('/api/form/sections/reorder', methods=['POST'])
def reorder_form_sections():
    if session.get('user_role') != 'admin': return jsonify({"error": "Admin access required."}), 403
    
    section_orders = request.json.get('sections', [])
    print(f"--- REORDER SECTIONS REQUEST ---")
    print(f"Sections to reorder: {section_orders}")
    
    if not section_orders:
        return jsonify({"error": "No sections provided for reordering."}), 400
    
    conn = get_db_conn()
    try:
        # Ensure sections table exists
        conn.execute("""
            CREATE TABLE IF NOT EXISTS form_sections (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT UNIQUE NOT NULL,
                section_order INTEGER DEFAULT 0,
                description TEXT,
                icon TEXT DEFAULT 'folder',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        
        cursor = conn.cursor()
        for order, section_name in enumerate(section_orders):
            print(f"Processing section '{section_name}' with order {order + 1}")
            
            # Check if section exists, then insert or update
            existing = cursor.execute("SELECT id FROM form_sections WHERE name = ?", (section_name,)).fetchone()
            
            if existing:
                print(f"Updating existing section '{section_name}' to order {order + 1}")
                # Update existing section order
                cursor.execute("""
                    UPDATE form_sections 
                    SET section_order = ?
                    WHERE name = ?
                """, (order + 1, section_name))
            else:
                print(f"Inserting new section '{section_name}' with order {order + 1}")
                # Insert new section with order
                cursor.execute("""
                    INSERT INTO form_sections (name, section_order, icon, description)
                    VALUES (?, ?, 'folder', '')
                """, (section_name, order + 1))
        
        conn.commit()
        print("--- REORDER COMPLETE ---")
        
        # Verify the changes
        updated_sections = cursor.execute("SELECT name, section_order FROM form_sections ORDER BY section_order").fetchall()
        print(f"Updated sections: {[(row['name'], row['section_order']) for row in updated_sections]}")
        
        return jsonify({"success": True, "message": "Sections reordered successfully."})
        
    except Exception as e:
        print(f"--- API ERROR in /api/form/sections/reorder ---\n{traceback.format_exc()}")
        return jsonify({"error": "Server error while reordering sections.", "message": str(e)}), 500
    finally:
        conn.close()

@app.route('/api/form/config/bulk-update', methods=['POST'])
def bulk_update_fields():
    if session.get('user_role') != 'admin': return jsonify({"error": "Admin access required."}), 403
    updates = request.json.get('updates', [])
    
    conn = get_db_conn()
    try:
        cursor = conn.cursor()
        for update in updates:
            field_id = update.get('id')
            if field_id:
                cursor.execute("""
                    UPDATE form_config 
                    SET required = ?, field_order = ?
                    WHERE id = ?
                """, (update.get('required', False), update.get('field_order', 0), field_id))
        conn.commit()
        return jsonify({"success": True, "message": "Fields updated successfully."})
    except Exception as e:
        print(f"--- API ERROR in /api/form/config/bulk-update ---\n{traceback.format_exc()}")
        return jsonify({"error": "Server error while updating fields.", "message": str(e)}), 500
    finally:
        conn.close()

# --- User and Status Management APIs ---
@app.route('/api/users', methods=['GET', 'POST'])
def api_manage_users():
    if session.get('user_role') != 'admin': return jsonify({"error": "Admin access required."}), 403
    conn = get_db_conn()
    if request.method == 'GET':
        users = conn.execute("SELECT id, email, role FROM users ORDER BY role, email").fetchall()
        conn.close()
        return jsonify([dict(user) for user in users])
    if request.method == 'POST':
        data = request.json
        email, password = data.get('email'), data.get('password')
        if not email or not password: return jsonify({"error": "Email and password are required."}), 400
        try:
            hashed_password = generate_password_hash(password)
            conn.execute("INSERT INTO users (email, password_hash, role) VALUES (?, ?, 'viewer')", (email, hashed_password))
            conn.commit()
            return jsonify({"success": True, "message": "Viewer added successfully."})
        except sqlite3.IntegrityError: return jsonify({"error": f"User with email '{email}' already exists."}), 409
        finally: conn.close()

@app.route('/api/users/delete', methods=['POST'])
def api_delete_user():
    if session.get('user_role') != 'admin': return jsonify({"error": "Admin access required."}), 403
    user_id_to_delete = request.json.get('id')
    if not user_id_to_delete: return jsonify({"error": "User ID is required."}), 400
    if user_id_to_delete == session.get('user_id'): return jsonify({"error": "Admin cannot delete their own account."}), 400
    conn = get_db_conn()
    conn.execute("DELETE FROM users WHERE id = ?", (user_id_to_delete,))
    conn.commit()
    conn.close()
    return jsonify({"success": True, "message": "User deleted."})

@app.route('/api/update_status', methods=['POST'])
def api_update_status():
    if session.get('user_role') != 'admin': return jsonify({"error": "Admin access required."}), 403
    data = request.json
    email, name, status = data.get('email'), data.get('name'), data.get('status')
    if not email or not status: return jsonify({"error": "Email and status are required."}), 400
    conn = get_db_conn()
    conn.execute("INSERT OR REPLACE INTO statuses (email, name, status) VALUES (?, ?, ?)", (email.lower(), name, status))
    conn.commit()
    conn.close()
    return jsonify({"success": True})


# --- Main Execution ---
if __name__ == '__main__':
    with app.app_context():
        init_db()
    app.run(host='0.0.0.0', port=5201, debug=True)
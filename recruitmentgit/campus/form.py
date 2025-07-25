import os
import sqlite3
import traceback
from flask import Flask, jsonify, render_template, request, send_from_directory
from werkzeug.utils import secure_filename
from flask_cors import CORS
from collections import defaultdict, OrderedDict
import json

# --- App Initialization ---
app = Flask(__name__,
            static_folder='.',
            template_folder='.')

# Allow requests from any origin to the API endpoints
CORS(app, resources={r"/api/*": {"origins": "*"}})

# MODIFIED: Point to the dashboard's database
DATABASE = '../dashboard/recruitment_final.db'
UPLOAD_FOLDER = 'uploads'
ALLOWED_EXTENSIONS = {'pdf'}
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER

if not os.path.exists(UPLOAD_FOLDER):
    os.makedirs(UPLOAD_FOLDER)

def allowed_file(filename):
    """Checks if the uploaded file has a permitted extension."""
    return '.' in filename and \
           filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

# --- Database Management ---

def get_db_conn():
    """Establishes a connection to the SQLite database."""
    conn = sqlite3.connect(DATABASE, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn

# --- Web Routes ---

@app.route('/')
def route_home():
    """Redirects the root URL to the login page."""
    return render_template('login.html')

@app.route('/login.html')
def route_login():
    """Serves the login page."""
    return render_template('login.html')

@app.route('/recruitment-form.html')
def route_recruitment_form():
    """Serves the main recruitment form page."""
    return render_template('recruitment-form.html')

@app.route('/uploads/<filename>')
def uploaded_file(filename):
    """Serves uploaded files from the 'uploads' directory."""
    return send_from_directory(app.config['UPLOAD_FOLDER'], filename)

# --- API Endpoints ---

@app.route('/api/public/form-config', methods=['GET'])
def get_public_form_config():
    """
    A public endpoint to fetch the form structure for any applicant.
    This reads the form configuration from the database and returns it as JSON.
    """
    try:
        conn = get_db_conn()
        
        # Get section order from form_sections table if it exists
        section_order = {}
        try:
            sections_query = conn.execute("SELECT name, section_order FROM form_sections ORDER BY section_order ASC").fetchall()
            if sections_query:
                section_order = {row['name']: row['section_order'] for row in sections_query}
        except sqlite3.OperationalError:
            # form_sections table might not exist in the campus DB, which is fine.
            pass

        fields_query = conn.execute("SELECT * FROM form_config ORDER BY field_order ASC").fetchall()
        conn.close()

        # Group fields by subsection
        subsections = defaultdict(list)
        for field in fields_query:
            subsections[field['subsection']].append(dict(field))

        # Order subsections based on section_order or fallback to field order
        if section_order:
            subsection_order = sorted(subsections.keys(), key=lambda k: section_order.get(k, 9999))
        else:
            subsection_order = sorted(subsections.keys(), key=lambda k: subsections[k][0]['field_order'] if subsections[k] else 0)

        ordered_subsections = OrderedDict()
        for k in subsection_order:
            ordered_subsections[k] = subsections[k]

        return jsonify(ordered_subsections)

    except Exception as e:
        print(f"--- API ERROR in /api/public/form-config ---\n{traceback.format_exc()}")
        return jsonify({"error": "Could not retrieve form configuration.", "message": str(e)}), 500


@app.route('/api/submit_application', methods=['POST'])
def api_submit_application():
    """
    Handles the form submission, including file uploads.
    Saves the application data to the database.
    """
    if 'cv-resume' not in request.files:
        return jsonify({"error": "No resume file part"}), 400

    file = request.files['cv-resume']
    if file.filename == '':
        return jsonify({"error": "No selected file"}), 400

    if file and allowed_file(file.filename):
        email = request.form.get('email', 'unknown_email')
        # Create a secure, unique filename to prevent overwrites
        unique_filename = f"{secure_filename(email)}_{secure_filename(file.filename)}"
        file_path = os.path.join(app.config['UPLOAD_FOLDER'], unique_filename)
        
        try:
            file.save(file_path)
            data = request.form.to_dict()
            data['resume_path'] = unique_filename

            conn = get_db_conn()
            cursor = conn.cursor()

            form_fields = cursor.execute("SELECT name FROM form_config").fetchall()
            valid_columns = {field['name'] for field in form_fields}
            valid_columns.add('resume_path')

            columns_to_insert = [col for col in data.keys() if col in valid_columns]
            if not columns_to_insert:
                return jsonify({"error": "No valid data fields received."}), 400
            
            values_to_insert = [data[col] for col in columns_to_insert]
            placeholders = ', '.join(['?'] * len(columns_to_insert))
            
            query = f"INSERT INTO applications ({', '.join(columns_to_insert)}) VALUES ({placeholders})"
            
            cursor.execute(query, values_to_insert)
            conn.commit()
            
            return jsonify({"success": True, "message": "Application submitted successfully."})

        except sqlite3.IntegrityError:
            return jsonify({"error": f"An application with the email '{data.get('email')}' already exists."}), 409
        except Exception as e:
            print(f"--- API ERROR in /api/submit_application ---\n{traceback.format_exc()}")
            # Clean up saved file on database error
            if os.path.exists(file_path):
                os.remove(file_path)
            return jsonify({"error": "An error occurred on the server.", "message": str(e)}), 500
        finally:
            if 'conn' in locals() and conn:
                conn.close()
    else:
        return jsonify({"error": "File type not allowed. Please upload a PDF."}), 400

# --- Main Execution ---
if __name__ == '__main__':
    # For development:
    # Use the Flask development server. It will automatically reload on code changes.
    # To run: python form.py
    app.run(host='0.0.0.0', port=5000, debug=True)

    # For production (to make it robust):
    # Use a production-grade WSGI server like Waitress.
    # 1. Install Waitress: pip install waitress
    # 2. Run the app with Waitress: waitress-serve --host=0.0.0.0 --port=5000 form:app
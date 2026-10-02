# Employee Management System — Python


import json
import os
import hashlib
from datetime import datetime


# ============================================================
# CONFIGURATION
# ============================================================

DATABASE_FILE = "employees.json"


# ============================================================
# DATABASE FUNCTIONS
# ============================================================

def load_data():
    """Load employee data from JSON file."""

    if not os.path.exists(DATABASE_FILE):
        data = {
            "users": [],
            "next_id": 1
        }

        save_data(data)
        return data

    with open(DATABASE_FILE, "r") as file:
        return json.load(file)


def save_data(data):
    """Save employee data to JSON file."""

    with open(DATABASE_FILE, "w") as file:
        json.dump(data, file, indent=4)


# ============================================================
# PASSWORD FUNCTIONS
# ============================================================

def hash_password(password):
    """Hash password before storing it."""

    return hashlib.sha256(
        password.encode()
    ).hexdigest()


def verify_password(password, stored_password):
    """Verify user password."""

    return hash_password(password) == stored_password


# ============================================================
# USER CREATION
# ============================================================

def create_user(data, name, email, password, role,
                department="", manager_id=None):

    user = {
        "id": data["next_id"],
        "name": name,
        "email": email,
        "password": hash_password(password),
        "role": role,
        "department": department,
        "manager_id": manager_id,
        "created_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "active": True
    }

    data["users"].append(user)
    data["next_id"] += 1

    save_data(data)

    return user


# ============================================================
# FIND USER
# ============================================================

def find_user_by_email(data, email):

    for user in data["users"]:

        if user["email"].lower() == email.lower():
            return user

    return None


def find_user_by_id(data, user_id):

    for user in data["users"]:

        if user["id"] == user_id:
            return user

    return None


# ============================================================
# LOGIN
# ============================================================

def login(data):

    print("\n========== LOGIN ==========")

    email = input("Email: ")
    password = input("Password: ")

    user = find_user_by_email(data, email)

    if user is None:
        print("User not found.")
        return None

    if not user["active"]:
        print("Your account is inactive.")
        return None

    if not verify_password(password, user["password"]):
        print("Incorrect password.")
        return None

    print(f"\nWelcome, {user['name']}!")
    print(f"Role: {user['role'].upper()}")

    return user


# ============================================================
# DISPLAY USER
# ============================================================

def display_user(user):

    print("\n----------------------------")
    print(f"ID          : {user['id']}")
    print(f"Name        : {user['name']}")
    print(f"Email       : {user['email']}")
    print(f"Role        : {user['role']}")
    print(f"Department  : {user['department']}")

    if user["manager_id"]:

        print(f"Manager ID  : {user['manager_id']}")

    print(f"Status      : {'Active' if user['active'] else 'Inactive'}")
    print("----------------------------")


# ============================================================
# ADMIN FUNCTIONS
# ============================================================

def admin_view_all_users(data):

    print("\n========== ALL EMPLOYEES ==========")

    if not data["users"]:
        print("No employees found.")
        return

    for user in data["users"]:
        display_user(user)


def admin_add_user(data):

    print("\n========== ADD USER ==========")

    name = input("Name: ")
    email = input("Email: ")
    password = input("Password: ")

    print("\nSelect Role")
    print("1. Admin")
    print("2. Manager")
    print("3. Employee")

    choice = input("Choice: ")

    roles = {
        "1": "admin",
        "2": "manager",
        "3": "employee"
    }

    if choice not in roles:
        print("Invalid role.")
        return

    role = roles[choice]

    department = input("Department: ")

    manager_id = None

    if role == "employee":

        print("\nAvailable Managers:")

        managers = [
            user for user in data["users"]
            if user["role"] == "manager"
            and user["active"]
        ]

        if not managers:
            print("No managers available.")
            return

        for manager in managers:
            print(
                f"{manager['id']}. "
                f"{manager['name']} "
                f"({manager['department']})"
            )

        try:
            manager_id = int(input("Manager ID: "))
        except ValueError:
            print("Invalid manager ID.")
            return

        manager = find_user_by_id(data, manager_id)

        if manager is None or manager["role"] != "manager":
            print("Invalid manager.")
            return

    if find_user_by_email(data, email):
        print("Email already exists.")
        return

    user = create_user(
        data,
        name,
        email,
        password,
        role,
        department,
        manager_id
    )

    print("\nUser created successfully.")
    display_user(user)


def admin_delete_user(data):

    print("\n========== DELETE USER ==========")

    try:
        user_id = int(input("Enter user ID: "))
    except ValueError:
        print("Invalid ID.")
        return

    user = find_user_by_id(data, user_id)

    if user is None:
        print("User not found.")
        return

    user["active"] = False

    save_data(data)

    print("User deactivated successfully.")


def admin_change_role(data):

    print("\n========== CHANGE ROLE ==========")

    try:
        user_id = int(input("Enter user ID: "))
    except ValueError:
        print("Invalid ID.")
        return

    user = find_user_by_id(data, user_id)

    if user is None:
        print("User not found.")
        return

    print("\n1. Admin")
    print("2. Manager")
    print("3. Employee")

    choice = input("Select new role: ")

    roles = {
        "1": "admin",
        "2": "manager",
        "3": "employee"
    }

    if choice not in roles:
        print("Invalid role.")
        return

    user["role"] = roles[choice]

    if user["role"] != "employee":
        user["manager_id"] = None

    save_data(data)

    print("Role updated successfully.")


# ============================================================
# MANAGER FUNCTIONS
# ============================================================

def manager_view_team(data, manager):

    print("\n========== MY TEAM ==========")

    team = [
        user for user in data["users"]
        if user["manager_id"] == manager["id"]
        and user["active"]
    ]

    if not team:
        print("No employees assigned to you.")
        return

    for employee in team:
        display_user(employee)


def manager_update_employee(data, manager):

    print("\n========== UPDATE TEAM MEMBER ==========")

    team = [
        user for user in data["users"]
        if user["manager_id"] == manager["id"]
        and user["active"]
    ]

    if not team:
        print("No team members.")
        return

    for employee in team:
        print(
            f"{employee['id']} - "
            f"{employee['name']}"
        )

    try:
        employee_id = int(input("Employee ID: "))
    except ValueError:
        print("Invalid ID.")
        return

    employee = find_user_by_id(data, employee_id)

    if employee is None:
        print("Employee not found.")
        return

    if employee["manager_id"] != manager["id"]:
        print("You don't have permission to update this employee.")
        return

    print("\n1. Update Name")
    print("2. Update Department")

    choice = input("Choice: ")

    if choice == "1":

        employee["name"] = input("New name: ")

    elif choice == "2":

        employee["department"] = input("New department: ")

    else:

        print("Invalid choice.")
        return

    save_data(data)

    print("Employee updated successfully.")


# ============================================================
# EMPLOYEE FUNCTIONS
# ============================================================

def employee_view_profile(employee):

    print("\n========== MY PROFILE ==========")

    display_user(employee)


def employee_update_profile(data, employee):

    print("\n========== UPDATE PROFILE ==========")

    print("1. Change Name")
    print("2. Change Email")

    choice = input("Choice: ")

    if choice == "1":

        employee["name"] = input("New name: ")

    elif choice == "2":

        new_email = input("New email: ")

        existing = find_user_by_email(data, new_email)

        if existing and existing["id"] != employee["id"]:
            print("Email already exists.")
            return

        employee["email"] = new_email

    else:

        print("Invalid choice.")
        return

    save_data(data)

    print("Profile updated successfully.")


# ============================================================
# ADMIN MENU
# ============================================================

def admin_menu(data, admin):

    while True:

        print("\n")
        print("================================")
        print("          ADMIN PANEL")
        print("================================")
        print("1. View all users")
        print("2. Add user")
        print("3. Deactivate user")
        print("4. Change user role")
        print("5. My profile")
        print("6. Logout")

        choice = input("Enter choice: ")

        if choice == "1":

            admin_view_all_users(data)

        elif choice == "2":

            admin_add_user(data)

        elif choice == "3":

            admin_delete_user(data)

        elif choice == "4":

            admin_change_role(data)

        elif choice == "5":

            display_user(admin)

        elif choice == "6":

            print("Logged out.")
            break

        else:

            print("Invalid choice.")


# ============================================================
# MANAGER MENU
# ============================================================

def manager_menu(data, manager):

    while True:

        print("\n")
        print("================================")
        print("         MANAGER PANEL")
        print("================================")
        print("1. View my team")
        print("2. Update team member")
        print("3. My profile")
        print("4. Logout")

        choice = input("Enter choice: ")

        if choice == "1":

            manager_view_team(data, manager)

        elif choice == "2":

            manager_update_employee(data, manager)

        elif choice == "3":

            display_user(manager)

        elif choice == "4":

            print("Logged out.")
            break

        else:

            print("Invalid choice.")


# ============================================================
# EMPLOYEE MENU
# ============================================================

def employee_menu(data, employee):

    while True:

        print("\n")
        print("================================")
        print("        EMPLOYEE PANEL")
        print("================================")
        print("1. View my profile")
        print("2. Update my profile")
        print("3. Logout")

        choice = input("Enter choice: ")

        if choice == "1":

            employee_view_profile(employee)

        elif choice == "2":

            employee_update_profile(data, employee)

        elif choice == "3":

            print("Logged out.")
            break

        else:

            print("Invalid choice.")


# ============================================================
# CREATE DEFAULT ADMIN
# ============================================================

def create_default_admin(data):

    if len(data["users"]) == 0:

        print("\nCreating default administrator...")

        create_user(
            data,
            "System Administrator",
            "admin@company.com",
            "admin123",
            "admin",
            "Administration"
        )

        print("\nDefault admin created.")
        print("Email    : admin@company.com")
        print("Password : admin123")


# ============================================================
# MAIN PROGRAM
# ============================================================

def main():

    data = load_data()

    create_default_admin(data)

    while True:

        print("\n")
        print("========================================")
        print("    EMPLOYEE MANAGEMENT SYSTEM")
        print("========================================")
        print("1. Login")
        print("2. Exit")

        choice = input("Enter choice: ")

        if choice == "1":

            user = login(data)

            if user is None:
                continue

            if user["role"] == "admin":

                admin_menu(data, user)

            elif user["role"] == "manager":

                manager_menu(data, user)

            elif user["role"] == "employee":

                employee_menu(data, user)

        elif choice == "2":

            print("Thank you for using the system.")
            break

        else:

            print("Invalid choice.")


# ============================================================
# PROGRAM START
# ============================================================

if __name__ == "__main__":
    main()



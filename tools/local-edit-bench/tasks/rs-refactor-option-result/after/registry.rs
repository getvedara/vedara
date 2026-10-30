#[derive(Debug, Clone, PartialEq)]
pub struct User {
    pub id: u32,
    pub name: String,
}

#[derive(Debug, PartialEq)]
pub enum LookupError {
    NotFound(u32),
}

#[derive(Default)]
pub struct Registry {
    users: Vec<User>,
}

impl Registry {
    pub fn add(&mut self, id: u32, name: &str) {
        self.users.push(User { id, name: name.to_string() });
    }

    pub fn find(&self, id: u32) -> Result<&User, LookupError> {
        self.users.iter().find(|u| u.id == id).ok_or(LookupError::NotFound(id))
    }

    pub fn display_name(&self, id: u32) -> String {
        match self.find(id) {
            Ok(user) => user.name.clone(),
            Err(_) => format!("<unknown #{id}>"),
        }
    }
}

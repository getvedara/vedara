#[derive(Debug, Clone, PartialEq)]
pub struct User {
    pub id: u32,
    pub name: String,
}

#[derive(Default)]
pub struct Registry {
    users: Vec<User>,
}

impl Registry {
    pub fn add(&mut self, id: u32, name: &str) {
        self.users.push(User { id, name: name.to_string() });
    }

    pub fn find(&self, id: u32) -> Option<&User> {
        self.users.iter().find(|u| u.id == id)
    }

    pub fn display_name(&self, id: u32) -> String {
        match self.find(id) {
            Some(user) => user.name.clone(),
            None => format!("<unknown #{id}>"),
        }
    }
}

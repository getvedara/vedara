pub struct Quota {
    pub limit: u32,
    pub used: u32,
}

impl Quota {
    pub fn new(limit: u32) -> Self {
        Quota { limit, used: 0 }
    }

    pub fn consume(&mut self, amount: u32) {
        self.used = self.used.saturating_add(amount);
    }

    pub fn remaining(&self) -> u32 {
        self.limit - self.used
    }

    pub fn is_exhausted(&self) -> bool {
        self.remaining() == 0
    }
}
